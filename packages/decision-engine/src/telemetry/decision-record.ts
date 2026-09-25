import { createHash, randomUUID } from 'node:crypto';
import {
  selectedValue,
  type DecisionKind,
  type DecisionQuestion,
  type DecisionResult,
  type DecisionState,
} from '../schemas/decision.js';
import type { DecisionRoute, RiskLevel } from '../policy/thresholds.js';

/**
 * Immutable record of one governed decision. The event ledger of these is where
 * AION's reliability story lives: which provider decided what, on what state,
 * how confident it was, where it was routed, and — once known — whether it was
 * right. Every field the brief calls for is here so calibration and cost/latency
 * questions can be answered from the ledger, not from vendor marketing.
 */
export type DecisionExecutionResult =
  | 'executed'
  | 'escalated'
  | 'blocked'
  | 'pending'
  | 'shadow';

export interface DecisionRecord {
  decisionId: string;
  missionId?: string;
  tenantId?: string;
  provider: string;
  modelVersion?: string;
  /** Stable hash of the state the decision was made on (for replay/audit). */
  stateHash: string;
  decisionType: DecisionKind;
  questionId: string;
  /** Declared choice space (choice questions only). */
  possibleChoices?: string[];
  selectedChoice: string | number | boolean;
  probabilities?: Record<string, number>;
  confidence: number;
  risk?: RiskLevel;
  route: DecisionRoute;
  /** Threshold that produced the route, when applicable. */
  policyThreshold?: number;
  /** Experiment this decision was routed under, if any (calibration by variant). */
  experimentKey?: string;
  /** Assigned experiment variant, if any. */
  variant?: string;
  executionResult?: DecisionExecutionResult;
  humanOverride?: {
    choice: string | number | boolean;
    by: string;
    at: string;
  };
  /** The correct answer, when it becomes known — powers calibration. */
  groundTruth?: string | number | boolean;
  latencyMs?: number;
  cost?: number;
  createdAt: string;
}

/** Deterministic SHA-256 of a JSON-serializable value with sorted keys. */
export function hashState(state: DecisionState): string {
  return createHash('sha256').update(stableStringify(state)).digest('hex');
}

export interface CreateDecisionRecordInput {
  question: DecisionQuestion;
  result: DecisionResult;
  provider: string;
  route: DecisionRoute;
  state: DecisionState;
  modelVersion?: string;
  risk?: RiskLevel;
  policyThreshold?: number;
  experimentKey?: string;
  variant?: string;
  executionResult?: DecisionExecutionResult;
  latencyMs?: number;
  cost?: number;
  missionId?: string;
  tenantId?: string;
  decisionId?: string;
  createdAt?: string;
  stateHash?: string;
}

export function createDecisionRecord(
  input: CreateDecisionRecordInput,
): DecisionRecord {
  const { question, result } = input;
  const record: DecisionRecord = {
    decisionId: input.decisionId ?? `dec_${randomUUID()}`,
    provider: input.provider,
    stateHash: input.stateHash ?? hashState(input.state),
    decisionType: question.kind,
    questionId: question.id,
    selectedChoice: selectedValue(result),
    confidence: result.confidence,
    route: input.route,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  if (input.modelVersion !== undefined) record.modelVersion = input.modelVersion;
  if (input.missionId !== undefined) record.missionId = input.missionId;
  else if (input.state.missionId !== undefined) record.missionId = input.state.missionId;
  if (input.tenantId !== undefined) record.tenantId = input.tenantId;
  else if (input.state.tenantId !== undefined) record.tenantId = input.state.tenantId;
  if (question.kind === 'choice') record.possibleChoices = question.choices;
  if (result.kind === 'choice') record.probabilities = result.probabilities;
  if (result.kind === 'binary') record.probabilities = result.probabilities;
  if (input.risk !== undefined) record.risk = input.risk;
  if (input.policyThreshold !== undefined) record.policyThreshold = input.policyThreshold;
  if (input.experimentKey !== undefined) record.experimentKey = input.experimentKey;
  if (input.variant !== undefined) record.variant = input.variant;
  if (input.executionResult !== undefined) record.executionResult = input.executionResult;
  if (input.latencyMs !== undefined) record.latencyMs = input.latencyMs;
  if (input.cost !== undefined) record.cost = input.cost;
  return record;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}
