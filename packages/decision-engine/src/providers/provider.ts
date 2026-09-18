import type {
  DecisionQuestion,
  DecisionResult,
  DecisionState,
} from '../schemas/decision.js';

/**
 * A DecisionProvider turns state + typed questions into typed decisions.
 *
 * This is the vendor-neutral seam the brief insists on: we adopt the
 * System-One *architecture*, not a single vendor. TypeSafe's Jev, an LLM used as
 * a judge, and a deterministic rules engine all implement this one interface, so
 * a provider can be swapped, cascaded, or run in shadow alongside another with
 * no change to callers.
 */
export interface DecisionProvider {
  /** Stable provider id recorded on every decision (e.g. "typesafe-jev"). */
  readonly name: string;
  /** Model / ruleset version, recorded for calibration and replay. */
  readonly modelVersion?: string;
  /**
   * Evaluate every question against the state. Implementations MUST return one
   * result per question, each valid within its question's declared output space
   * (see {@link assertResultValid}).
   */
  evaluate(
    state: DecisionState,
    questions: DecisionQuestion[],
  ): Promise<DecisionResult[]>;
}

export class DecisionProviderError extends Error {
  readonly provider: string;
  constructor(provider: string, message: string) {
    super(message);
    this.name = 'DecisionProviderError';
    this.provider = provider;
  }
}
