import type {
  DecisionQuestion,
  DecisionResult,
  DecisionState,
} from './schemas/decision.js';
import { assertResultValid } from './schemas/decision.js';
import type { DecisionProvider } from './providers/provider.js';
import {
  routeDecision,
  type RiskLevel,
  type RouteDecision,
  type ThresholdPolicy,
} from './policy/thresholds.js';
import {
  createDecisionRecord,
  hashState,
  type DecisionRecord,
} from './telemetry/decision-record.js';
import type { ExperimentProvider } from './experiments/experiment-provider.js';

/**
 * DecisionEngine — the façade an agent or app calls.
 *
 * It runs a provider, routes the result through the confidence policy, measures
 * latency, and emits an immutable {@link DecisionRecord}. It does NOT execute
 * anything: routing to `auto_execute` is a recommendation the AION policy engine
 * and Execution Gateway still authorize. In `shadow` mode the record is marked
 * accordingly so decisions can be logged against live state without acting.
 */
export interface DecisionEngineOptions {
  provider: DecisionProvider;
  policy?: Partial<ThresholdPolicy>;
  /** Sink for every record produced (ledger write, telemetry, etc.). */
  onRecord?: (record: DecisionRecord) => void;
  /** Injectable clock (returns ms since epoch) for deterministic tests. */
  now?: () => number;
  /** Injectable ISO timestamp for records. */
  isoNow?: () => string;
  /**
   * Optional experiment over routing thresholds. When set, each decision is
   * assigned a variant (bucketed by `unitFrom`; default tenantId ?? missionId ??
   * "global"), the variant's threshold overrides are merged onto `policy`, and
   * the DecisionRecord is tagged with { experimentKey, variant } so the shadow
   * evaluator can measure each variant separately. The plane still never
   * executes — this only tunes which route a confidence lands on.
   */
  experiment?: {
    provider: ExperimentProvider;
    key: string;
    /** variant name -> threshold overrides merged onto the base policy. */
    variants: Record<string, Partial<ThresholdPolicy>>;
    /** Derive the bucketing unit; must be a stable non-PII id. */
    unitFrom?: (state: DecisionState, options: DecideOptions) => string;
  };
}

export interface DecideOptions {
  risk?: RiskLevel;
  missionId?: string;
  tenantId?: string;
  /** 'live' (default) routes for action; 'shadow' records without acting. */
  mode?: 'live' | 'shadow';
  /** Per-decision cost (abstract units), recorded for FinOps. */
  cost?: number;
}

export interface DecideOutcome {
  result: DecisionResult;
  route: RouteDecision;
  record: DecisionRecord;
}

export class DecisionEngine {
  private readonly options: DecisionEngineOptions;

  constructor(options: DecisionEngineOptions) {
    this.options = options;
  }

  async decide(
    state: DecisionState,
    question: DecisionQuestion,
    options: DecideOptions = {},
  ): Promise<DecideOutcome> {
    const [outcome] = await this.decideMany(state, [question], options);
    return outcome!;
  }

  async decideMany(
    state: DecisionState,
    questions: DecisionQuestion[],
    options: DecideOptions = {},
  ): Promise<DecideOutcome[]> {
    const clock = this.options.now ?? (() => Date.now());
    const started = clock();
    const results = await this.options.provider.evaluate(state, questions);
    const elapsed = clock() - started;

    if (results.length !== questions.length) {
      throw new Error(
        `provider "${this.options.provider.name}" returned ${results.length} results for ${questions.length} questions`,
      );
    }

    // Latency is measured once for the batch; attribute evenly per decision.
    const perDecisionLatency = elapsed / questions.length;
    const risk: RiskLevel = options.risk ?? 'R1';
    const mode = options.mode ?? 'live';
    const stateHash = hashState(state);

    // Resolve the experiment variant + effective policy once per call. Variant
    // assignment is sticky per bucketing unit and never carries PII.
    const experiment = this.options.experiment;
    let variant: string | undefined;
    let effectivePolicy = this.options.policy;
    if (experiment) {
      const tenantId = options.tenantId ?? state.tenantId;
      const unit =
        experiment.unitFrom?.(state, options) ??
        tenantId ??
        options.missionId ??
        state.missionId ??
        'global';
      variant = experiment.provider.variant(experiment.key, {
        unit,
        ...(tenantId !== undefined ? { tenantId } : {}),
      });
      const overrides = variant ? experiment.variants[variant] : undefined;
      if (overrides) {
        effectivePolicy = { ...(this.options.policy ?? {}), ...overrides };
      }
    }

    return questions.map((question, i) => {
      const result = results[i]!;
      assertResultValid(question, result);
      const route = routeDecision({
        confidence: result.confidence,
        risk,
        ...(effectivePolicy ? { policy: effectivePolicy } : {}),
      });
      const record = createDecisionRecord({
        question,
        result,
        provider: this.options.provider.name,
        route: route.route,
        state,
        stateHash,
        risk,
        latencyMs: perDecisionLatency,
        executionResult: mode === 'shadow' ? 'shadow' : 'pending',
        ...(this.options.provider.modelVersion !== undefined
          ? { modelVersion: this.options.provider.modelVersion }
          : {}),
        ...(route.threshold !== undefined
          ? { policyThreshold: route.threshold }
          : {}),
        ...(experiment ? { experimentKey: experiment.key } : {}),
        ...(variant !== undefined ? { variant } : {}),
        ...(options.missionId !== undefined
          ? { missionId: options.missionId }
          : {}),
        ...(options.tenantId !== undefined
          ? { tenantId: options.tenantId }
          : {}),
        ...(options.cost !== undefined ? { cost: options.cost } : {}),
        ...(this.options.isoNow ? { createdAt: this.options.isoNow() } : {}),
      });
      this.options.onRecord?.(record);
      return { result, route, record };
    });
  }
}
