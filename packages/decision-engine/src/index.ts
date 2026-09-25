/**
 * @aion/decision-engine — the AION Decision Plane.
 *
 * A vendor-neutral "System One" layer: fast, typed, calibrated judgments (route,
 * score, verify) that decide *what* should happen, leaving generative models to
 * create/communicate and the AION policy engine + Execution Gateway to authorize
 * and act. Adopt the architecture, not a vendor — every provider (TypeSafe Jev,
 * an LLM judge, a rules engine) sits behind one {@link DecisionProvider}.
 *
 *   providers  — DecisionProvider seam + Rules / LLM / TypeSafe implementations
 *   policy     — confidence + risk → route (auto / verify / reason / human)
 *   telemetry  — the immutable DecisionRecord that fills the reliability ledger
 *   evals      — shadow-mode calibration so thresholds come from data
 *   engine     — the façade: run → route → record (never executes)
 */

// Typed decision space
export {
  type DecisionKind,
  type DecisionQuestion,
  type BinaryQuestion,
  type ChoiceQuestion,
  type ScoreQuestion,
  type DecisionState,
  type DecisionResult,
  type BinaryResult,
  type ChoiceResult,
  type ScoreResult,
  selectedValue,
  clampConfidence,
  normalizeProbabilities,
  argmax,
  assertResultValid,
  DecisionValidationError,
} from './schemas/decision.js';

// Providers
export {
  type DecisionProvider,
  DecisionProviderError,
} from './providers/provider.js';
export {
  RulesProvider,
  type RulesConfig,
  type BinaryRule,
  type ChoiceRule,
  type ScoreRule,
} from './providers/rules.js';
export {
  LLMDecisionProvider,
  type LLMDecisionProviderConfig,
  type LLMJudge,
  type LLMJudgeInput,
  type LLMJudgeOutput,
  renderInstruction,
} from './providers/llm.js';
export {
  TypeSafeJevProvider,
  type TypeSafeJevConfig,
  type JevResponse,
  buildJevRequest,
  mapJevResponse,
} from './providers/typesafe.js';

// Policy
export {
  type RiskLevel,
  riskRank,
  type DecisionRoute,
  type ThresholdPolicy,
  DEFAULT_THRESHOLD_POLICY,
  type RouteInput,
  type RouteDecision,
  routeDecision,
  isAutonomousRoute,
} from './policy/thresholds.js';

// Telemetry
export {
  type DecisionRecord,
  type DecisionExecutionResult,
  type CreateDecisionRecordInput,
  createDecisionRecord,
  hashState,
} from './telemetry/decision-record.js';

// Evaluation
export {
  type CalibrationBucket,
  type ShadowReport,
  type EvaluateShadowOptions,
  evaluateShadow,
  evaluateShadowByVariant,
} from './evals/calibration.js';

// Experiments
export {
  type ExperimentProvider,
  type ExperimentContext,
  StaticExperimentProvider,
  type StaticExperimentConfig,
  HashExperimentProvider,
  type HashExperimentConfig,
  type VariantWeight,
  hashUnitInterval,
} from './experiments/experiment-provider.js';

// Engine façade
export {
  DecisionEngine,
  type DecisionEngineOptions,
  type DecideOptions,
  type DecideOutcome,
} from './engine.js';
