import type { DecisionRecord } from "@aion/decision-engine";

/**
 * Decision-plane analytics streaming (ADR-010 Phase 3).
 *
 * Streams shadow {@link DecisionRecord}s into the analytics plane so the
 * calibration loop (accuracy, route mix, per-variant experiment metrics) is
 * visible in dashboards instead of only over an in-process report call.
 *
 * Boundary rules (ADR-010): the analytics plane sits BESIDE the control plane,
 * never inside it. So:
 *  - the seam ({@link DecisionAnalyticsSink}) is vendor-neutral, and the decision
 *    engine stays free of any analytics SDK;
 *  - the vendor client is injected at the composition root — this module depends
 *    only on the structural {@link AnalyticsClient}, never on a specific SDK;
 *  - only non-PII decision metadata is emitted. The deciding human
 *    (humanOverride.by) is NEVER sent — we emit whether the shadow AGREED with
 *    the human, not who decided.
 */

/** The seam the recorder emits through. Emission must never throw to the caller. */
export interface DecisionAnalyticsSink {
  /** A shadow decision was recorded at the approval gate. */
  recorded(record: DecisionRecord): void;
  /** The human decision settled the shadow record (ground truth known). */
  settled(record: DecisionRecord): void;
  /** Flush any buffered events (best-effort; called on shutdown). */
  flush(): Promise<void>;
}

/**
 * The minimal surface we use from an analytics client (posthog-node's PostHog
 * satisfies this). Injected at the composition root so this module needs no SDK.
 */
export interface AnalyticsClient {
  capture(payload: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
  }): void;
  shutdown(): Promise<void> | void;
}

export const RECORDED_EVENT = "aion_decision_shadow_recorded";
export const SETTLED_EVENT = "aion_decision_shadow_settled";

/**
 * Non-PII properties for the "recorded" event. Deliberately enumerated (not a
 * spread of the record) so a new PII-bearing field can never leak by accident.
 */
export function recordedProperties(r: DecisionRecord): Record<string, unknown> {
  return {
    decision_id: r.decisionId,
    provider: r.provider,
    model_version: r.modelVersion,
    decision_type: r.decisionType,
    question_id: r.questionId,
    selected_choice: r.selectedChoice,
    confidence: r.confidence,
    route: r.route,
    risk: r.risk,
    policy_threshold: r.policyThreshold,
    experiment_key: r.experimentKey,
    variant: r.variant,
    execution_result: r.executionResult,
    latency_ms: r.latencyMs,
    cost: r.cost,
    tenant_id: r.tenantId,
    mission_id: r.missionId,
  };
}

/**
 * Non-PII properties for the "settled" event. Carries the ground truth and
 * whether the shadow agreed — but NEVER `humanOverride.by` (a username).
 */
export function settledProperties(r: DecisionRecord): Record<string, unknown> {
  const groundTruth = r.groundTruth;
  const agreed =
    groundTruth === undefined ? undefined : r.selectedChoice === groundTruth;
  return {
    decision_id: r.decisionId,
    provider: r.provider,
    decision_type: r.decisionType,
    question_id: r.questionId,
    selected_choice: r.selectedChoice,
    ground_truth: groundTruth,
    agreed,
    confidence: r.confidence,
    route: r.route,
    risk: r.risk,
    experiment_key: r.experimentKey,
    variant: r.variant,
    tenant_id: r.tenantId,
    mission_id: r.missionId,
  };
}

/** No-op sink — the safe default when no analytics backend is configured. */
export const noopDecisionAnalyticsSink: DecisionAnalyticsSink = {
  recorded() {},
  settled() {},
  async flush() {},
};

/**
 * Streams decision records to an injected {@link AnalyticsClient} (PostHog at the
 * composition root). A single, constant distinct id keeps these server-side
 * decisions out of person analytics — every dimension for calibration and
 * per-variant experiment analysis lives in the event properties.
 */
export class PostHogDecisionSink implements DecisionAnalyticsSink {
  constructor(
    private readonly client: AnalyticsClient,
    private readonly distinctId: string = "aion-action-service",
  ) {}

  recorded(record: DecisionRecord): void {
    this.capture(RECORDED_EVENT, recordedProperties(record));
  }

  settled(record: DecisionRecord): void {
    this.capture(SETTLED_EVENT, settledProperties(record));
  }

  async flush(): Promise<void> {
    try {
      await this.client.shutdown();
    } catch {
      /* best-effort: analytics flush never blocks shutdown */
    }
  }

  private capture(event: string, properties: Record<string, unknown>): void {
    try {
      this.client.capture({ distinctId: this.distinctId, event, properties });
    } catch {
      /* the analytics plane is beside the control plane — never let it throw in */
    }
  }
}
