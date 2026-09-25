/**
 * Confidence → route policy engine.
 *
 * A decision's confidence is a *signal*, never permission. This module turns a
 * (confidence, risk) pair into a route through the AION stack — fast path,
 * verification, reasoning, or a human gate — and encodes the one hard rule the
 * brief insists on: a high-risk action goes to a human regardless of how
 * confident the model is. Thresholds are defaults, meant to be replaced by the
 * tenant's own empirical calibration data (see the shadow evaluator).
 *
 * Risk uses the AION governance taxonomy (R0–R3, aion-core / ADR governance) so
 * this plane speaks the same language as the Execution Gateway it feeds.
 */

export type RiskLevel = 'R0' | 'R1' | 'R2' | 'R3';

const RISK_RANK: Record<RiskLevel, number> = { R0: 0, R1: 1, R2: 2, R3: 3 };

export function riskRank(level: RiskLevel): number {
  return RISK_RANK[level];
}

export type DecisionRoute =
  | 'auto_execute'
  | 'auto_execute_low_risk'
  | 'llm_verify'
  | 'reasoning'
  | 'human_approval';

export interface ThresholdPolicy {
  /** >= this confidence may auto-execute (subject to risk). Default 0.97. */
  autoExecute: number;
  /** >= this confidence auto-executes only for low-risk actions. Default 0.90. */
  autoExecuteLowRisk: number;
  /** >= this confidence goes to LLM verification. Default 0.75. Below → reasoning. */
  llmVerify: number;
  /**
   * Actions at or above this risk always require a human, regardless of
   * confidence. Default 'R3'.
   */
  humanApprovalRisk: RiskLevel;
  /**
   * The highest risk still considered "low" for the auto_execute_low_risk band.
   * Default 'R1' (R0/R1 auto-eligible; R2 escalates to verification).
   */
  lowRiskCeiling: RiskLevel;
}

export const DEFAULT_THRESHOLD_POLICY: ThresholdPolicy = {
  autoExecute: 0.97,
  autoExecuteLowRisk: 0.9,
  llmVerify: 0.75,
  humanApprovalRisk: 'R3',
  lowRiskCeiling: 'R1',
};

export interface RouteInput {
  confidence: number;
  risk: RiskLevel;
  policy?: Partial<ThresholdPolicy>;
}

export interface RouteDecision {
  route: DecisionRoute;
  reason: string;
  /** The policy threshold that applied to this decision (for the record). */
  threshold?: number;
}

/**
 * Route a decision. Evaluation order:
 *   1. high risk (>= humanApprovalRisk) → human_approval (hard rule).
 *   2. confidence >= autoExecute → auto_execute.
 *   3. confidence >= autoExecuteLowRisk → auto_execute_low_risk when the action
 *      is low-risk, else llm_verify.
 *   4. confidence >= llmVerify → llm_verify.
 *   5. otherwise → reasoning.
 */
export function routeDecision(input: RouteInput): RouteDecision {
  const policy = { ...DEFAULT_THRESHOLD_POLICY, ...input.policy };
  const confidence = input.confidence;
  const risk = input.risk;

  if (riskRank(risk) >= riskRank(policy.humanApprovalRisk)) {
    return {
      route: 'human_approval',
      reason: `risk ${risk} at/above ${policy.humanApprovalRisk} requires a human gate regardless of confidence`,
    };
  }

  if (confidence >= policy.autoExecute) {
    return {
      route: 'auto_execute',
      reason: `confidence ${fmt(confidence)} >= ${policy.autoExecute} at risk ${risk}`,
      threshold: policy.autoExecute,
    };
  }

  if (confidence >= policy.autoExecuteLowRisk) {
    if (riskRank(risk) <= riskRank(policy.lowRiskCeiling)) {
      return {
        route: 'auto_execute_low_risk',
        reason: `confidence ${fmt(confidence)} >= ${policy.autoExecuteLowRisk} and risk ${risk} is low`,
        threshold: policy.autoExecuteLowRisk,
      };
    }
    return {
      route: 'llm_verify',
      reason: `confidence ${fmt(confidence)} >= ${policy.autoExecuteLowRisk} but risk ${risk} exceeds low-risk ceiling ${policy.lowRiskCeiling}`,
      threshold: policy.autoExecuteLowRisk,
    };
  }

  if (confidence >= policy.llmVerify) {
    return {
      route: 'llm_verify',
      reason: `confidence ${fmt(confidence)} in [${policy.llmVerify}, ${policy.autoExecuteLowRisk}) → verify`,
      threshold: policy.llmVerify,
    };
  }

  return {
    route: 'reasoning',
    reason: `confidence ${fmt(confidence)} < ${policy.llmVerify} → escalate to reasoning`,
    threshold: policy.llmVerify,
  };
}

/** True when a route runs without any further model or human involvement. */
export function isAutonomousRoute(route: DecisionRoute): boolean {
  return route === 'auto_execute' || route === 'auto_execute_low_risk';
}

function fmt(n: number): string {
  return n.toFixed(2);
}
