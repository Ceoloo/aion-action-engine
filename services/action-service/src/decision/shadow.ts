import type { ActionObject } from "@aion/core";
import {
  DecisionEngine,
  RulesProvider,
  evaluateShadow,
  evaluateShadowByVariant,
  type BinaryQuestion,
  type DecisionRecord,
  type DecisionState,
  type ExperimentProvider,
  type ShadowReport,
  type ThresholdPolicy,
} from "@aion/decision-engine";
import {
  noopDecisionAnalyticsSink,
  type DecisionAnalyticsSink,
} from "./analytics-sink.js";

/**
 * Shadow-mode Decision Plane for the action queue (ADR-010 Phase 2).
 *
 * The DecisionEngine ("System One") runs alongside the human approval step:
 * for every action reaching a decision, it predicts whether the action should
 * be auto-approved, records the decision + route in the ledger, and — crucially
 * — does NOT act on it. The human's approve/reject stays the sole authority and
 * becomes the record's ground truth, so the shadow report answers "how often
 * would auto-approve have agreed with the human, and how well-calibrated is the
 * confidence?" from live data instead of a guess. This is exactly the
 * calibration loop the ADR calls for; nothing here executes or authorizes.
 */

/** The single binary the plane shadows at the approval gate. */
export const APPROVE_QUESTION: BinaryQuestion = {
  id: "approve_action",
  kind: "binary",
  prompt: "Should this action be auto-approved without a human?",
};

/**
 * Action types that carry outward, hard-to-reverse effects. A shadow decision
 * on these leans toward "needs a human", mirroring how the control plane treats
 * higher-risk capabilities — never a substitute for the policy engine, only a
 * calibrated signal.
 */
const OUTWARD_ACTION_TYPES = new Set<string>([
  "send_payment",
  "refund",
  "delete",
  "terminate",
  "contract_send",
]);

const URGENCY_ADJUSTMENT: Record<string, number> = {
  // Critical/high urgency is a reason to bring a human in, not to rush past one.
  critical: -0.3,
  high: -0.1,
  medium: 0,
  low: 0.1,
};

/**
 * Deterministic probability-of-auto-approve in [0, 1] from an action's own
 * features. Pure and side-effect free so a decision is replayable from its
 * state hash. Higher business priority raises it; higher urgency and outward
 * (hard-to-reverse) action types lower it.
 */
export function approvalProbability(features: {
  priority?: number;
  urgency?: string;
  action_type?: string;
}): number {
  const priority = typeof features.priority === "number" ? features.priority : 50;
  let p = priority / 100;
  p += URGENCY_ADJUSTMENT[features.urgency ?? "medium"] ?? 0;
  if (features.action_type && OUTWARD_ACTION_TYPES.has(features.action_type)) {
    p -= 0.25;
  }
  return Math.min(1, Math.max(0, p));
}

/** Map an action to the decision state the provider sees (non-PII features). */
export function actionDecisionState(action: ActionObject): DecisionState {
  return {
    features: {
      // The action id is a stable, non-PII key — it is the experiment bucketing
      // unit (see buildApprovalDecisionEngine) so a weighted experiment actually
      // splits per action instead of collapsing every action onto "global".
      id: action.id,
      priority: action.priority,
      urgency: action.urgency,
      action_type: action.action_type,
      entity_type: action.entity_type,
      source: action.source,
      requires_approval: action.requires_approval,
    },
  };
}

export interface ExperimentConfig {
  provider: ExperimentProvider;
  key: string;
  variants: Record<string, Partial<ThresholdPolicy>>;
  /** Derive the bucketing unit; defaults to the action id (stable, non-PII). */
  unitFrom?: (state: DecisionState) => string;
}

export interface ShadowRecorderOptions {
  /** Base threshold policy (variant overrides merge on top when experimenting). */
  policy?: Partial<ThresholdPolicy>;
  /** Optional experiment over routing thresholds — measurable per variant. */
  experiment?: ExperimentConfig;
  /** Injectable ISO clock for deterministic tests. */
  isoNow?: () => string;
  /**
   * Retention bound for the in-memory ledger (default 5000). The oldest record
   * is evicted once the bound is exceeded so a long-running service cannot grow
   * the ledger — or the cost of a report traversal — without limit.
   */
  maxRecords?: number;
  /**
   * Analytics sink for streaming records to the analytics plane (ADR-010
   * Phase 3). Defaults to a no-op; a PostHog-backed sink is injected at the
   * composition root. Emission never affects the approval outcome.
   */
  sink?: DecisionAnalyticsSink;
}

/** Stable, non-PII bucketing unit: the action id, else "global". */
function actionUnit(state: DecisionState): string {
  const id = state.features.id;
  return typeof id === "string" && id.length > 0 ? id : "global";
}

/** Build the approval DecisionEngine backed by the deterministic rules provider. */
export function buildApprovalDecisionEngine(
  options: ShadowRecorderOptions = {},
  onRecord?: (record: DecisionRecord) => void,
): DecisionEngine {
  return new DecisionEngine({
    provider: new RulesProvider({
      binary: {
        [APPROVE_QUESTION.id]: (state) =>
          approvalProbability(state.features as Parameters<typeof approvalProbability>[0]),
      },
      modelVersion: "approval-rules-v1",
    }),
    ...(options.policy ? { policy: options.policy } : {}),
    ...(options.experiment
      ? {
          experiment: {
            ...options.experiment,
            unitFrom: options.experiment.unitFrom ?? actionUnit,
          },
        }
      : {}),
    ...(options.isoNow ? { isoNow: options.isoNow } : {}),
    ...(onRecord ? { onRecord } : {}),
  });
}

/**
 * In-memory ledger of shadow decisions, keyed by action id. First-integration
 * scope: records live with the running service and feed the report endpoints.
 * (A durable ledger — a decisions table or a PostHog stream — is a later step;
 * the port here stays the same.)
 */
const DEFAULT_MAX_RECORDS = 5000;

export class ShadowDecisionRecorder {
  private readonly engine: DecisionEngine;
  private readonly byAction = new Map<string, DecisionRecord>();
  private readonly maxRecords: number;
  private readonly sink: DecisionAnalyticsSink;

  constructor(private readonly options: ShadowRecorderOptions = {}) {
    this.engine = buildApprovalDecisionEngine(options);
    this.maxRecords =
      options.maxRecords && options.maxRecords > 0
        ? options.maxRecords
        : DEFAULT_MAX_RECORDS;
    this.sink = options.sink ?? noopDecisionAnalyticsSink;
  }

  /**
   * Run the shadow decision for an action pending approval and store the record.
   * Never throws into the caller's control path: a Decision Plane fault must not
   * break the action queue (it is an observer, not the authority).
   */
  async observe(action: ActionObject): Promise<DecisionRecord | null> {
    try {
      const { result, record } = await this.engine.decide(
        actionDecisionState(action),
        APPROVE_QUESTION,
        { mode: "shadow", risk: "R1" },
      );
      // The question is "auto-approve?"; a confident `false` means "needs a
      // human", so it must never count as an autonomous route. Confidence-based
      // routing alone can't tell YES from NO, so pin a NO prediction to the
      // human path — otherwise autoRoute / false-automation metrics would credit
      // a confident rejection as an auto-execution.
      const routed: DecisionRecord =
        result.kind === "binary" && result.choice === false
          ? { ...record, route: "human_approval" }
          : record;
      this.byAction.set(action.id, routed);
      this.evictIfNeeded();
      this.sink.recorded(routed); // stream to the analytics plane (never throws in)
      return routed;
    } catch {
      return null;
    }
  }

  /** Drop the oldest record(s) once the retention bound is exceeded (FIFO). */
  private evictIfNeeded(): void {
    while (this.byAction.size > this.maxRecords) {
      const oldest = this.byAction.keys().next().value;
      if (oldest === undefined) break;
      this.byAction.delete(oldest);
    }
  }

  /**
   * Record the human's approve/reject for the shadowed action. At the approval
   * gate the human decision is authoritative, so it is both the ground truth
   * (for accuracy/calibration) and the recorded human decision (so the report's
   * human-disagreement rate measures how often auto-approve differed from the
   * human across every settled decision, not only the ones that differed).
   */
  settle(actionId: string, humanApprove: boolean, by: string): void {
    const record = this.byAction.get(actionId);
    if (!record) return;
    const settled: DecisionRecord = {
      ...record,
      groundTruth: humanApprove,
      humanOverride: {
        choice: humanApprove,
        by,
        at: this.options.isoNow?.() ?? new Date().toISOString(),
      },
    };
    this.byAction.set(actionId, settled);
    this.sink.settled(settled); // ground truth known → stream it (never throws in)
  }

  /** Flush any buffered analytics events; best-effort, called on shutdown. */
  async flush(): Promise<void> {
    await this.sink.flush();
  }

  /** All shadow records captured so far (newest insertion order). */
  records(): DecisionRecord[] {
    return [...this.byAction.values()];
  }

  recordFor(actionId: string): DecisionRecord | undefined {
    return this.byAction.get(actionId);
  }

  /** Calibration report over every shadow record with known ground truth. */
  report(): ShadowReport {
    return evaluateShadow(this.records());
  }

  /** Same report segmented by experiment variant (control vs treatment). */
  reportByVariant(): Record<string, ShadowReport> {
    return evaluateShadowByVariant(this.records());
  }
}
