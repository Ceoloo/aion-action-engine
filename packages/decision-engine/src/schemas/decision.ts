/**
 * Typed decision space.
 *
 * The Decision Plane (Sep 2026 brief) replaces "ask a generative model and parse
 * whatever text comes back" with a *constrained* decision: the valid outputs are
 * declared ahead of time, and every result is validated against that space. A
 * provider structurally cannot invent a new output type — a choice result is
 * always one of the declared choices, a binary result is always a boolean.
 *
 * The important nuance (TypeSafe's "zero hallucinations" claim needs it): a valid
 * output is not the same as a correct decision. This module guarantees the
 * former only. Correctness is measured empirically by the shadow evaluator, and
 * the confidence a provider reports is a *signal*, never permission — the policy
 * engine and the Execution Gateway decide what is allowed to happen.
 */

export type DecisionKind = 'binary' | 'choice' | 'score';

export interface BinaryQuestion {
  id: string;
  kind: 'binary';
  /** e.g. "Is this contact a decision maker?" */
  prompt: string;
}

export interface ChoiceQuestion {
  id: string;
  kind: 'choice';
  prompt: string;
  /** The closed set of valid answers, declared up front. Must be non-empty. */
  choices: string[];
}

export interface ScoreQuestion {
  id: string;
  kind: 'score';
  prompt: string;
  /** Inclusive bounds; default [0, 1]. */
  min?: number;
  max?: number;
}

export type DecisionQuestion = BinaryQuestion | ChoiceQuestion | ScoreQuestion;

/**
 * The context handed to a provider. `features` is a free-form bag of state
 * (CRM fields, recent events, memory, a transcript, …). It is hashed into the
 * decision record so a decision can be replayed and audited.
 */
export interface DecisionState {
  features: Record<string, unknown>;
  tenantId?: string;
  missionId?: string;
}

export interface BinaryResult {
  questionId: string;
  kind: 'binary';
  choice: boolean;
  /** Calibrated confidence in [0, 1]. */
  confidence: number;
  probabilities: { true: number; false: number };
}

export interface ChoiceResult {
  questionId: string;
  kind: 'choice';
  /** Always a member of the question's declared `choices`. */
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface ScoreResult {
  questionId: string;
  kind: 'score';
  /** Always within the question's [min, max] bounds. */
  score: number;
  confidence: number;
}

export type DecisionResult = BinaryResult | ChoiceResult | ScoreResult;

/** The selected value of a result, normalized across kinds (for records/evals). */
export function selectedValue(result: DecisionResult): string | number | boolean {
  switch (result.kind) {
    case 'binary':
      return result.choice;
    case 'choice':
      return result.choice;
    case 'score':
      return result.score;
  }
}

/** Clamp a number into [0, 1]. */
export function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Normalize a probability map so its values are non-negative and sum to 1.
 * An all-zero (or empty) map becomes a uniform distribution over its keys.
 */
export function normalizeProbabilities(
  raw: Record<string, number>,
): Record<string, number> {
  const keys = Object.keys(raw);
  if (keys.length === 0) return {};
  const nonNeg = keys.map((k) => Math.max(0, raw[k] ?? 0));
  const sum = nonNeg.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  if (sum === 0) {
    const u = 1 / keys.length;
    keys.forEach((k) => {
      out[k] = u;
    });
    return out;
  }
  keys.forEach((k, i) => {
    out[k] = nonNeg[i]! / sum;
  });
  return out;
}

/** The key with the highest probability (ties broken by first-seen order). */
export function argmax(probabilities: Record<string, number>): {
  choice: string;
  confidence: number;
} {
  let best: string | undefined;
  let bestP = -Infinity;
  for (const [k, v] of Object.entries(probabilities)) {
    if (v > bestP) {
      best = k;
      bestP = v;
    }
  }
  if (best === undefined) {
    throw new Error('argmax on an empty probability map');
  }
  return { choice: best, confidence: clampConfidence(bestP) };
}

export class DecisionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionValidationError';
  }
}

/**
 * Assert a result is within the declared output space of its question. This is
 * the structural guarantee: a provider that returns an out-of-space answer is
 * rejected here rather than silently flowing downstream.
 */
export function assertResultValid(
  question: DecisionQuestion,
  result: DecisionResult,
): void {
  if (question.id !== result.questionId) {
    throw new DecisionValidationError(
      `result questionId "${result.questionId}" != question id "${question.id}"`,
    );
  }
  if (question.kind !== result.kind) {
    throw new DecisionValidationError(
      `result kind "${result.kind}" != question kind "${question.kind}" for "${question.id}"`,
    );
  }
  if (result.confidence < 0 || result.confidence > 1) {
    throw new DecisionValidationError(
      `confidence ${result.confidence} out of [0,1] for "${question.id}"`,
    );
  }
  if (question.kind === 'choice' && result.kind === 'choice') {
    if (question.choices.length === 0) {
      throw new DecisionValidationError(
        `choice question "${question.id}" declares no choices`,
      );
    }
    if (!question.choices.includes(result.choice)) {
      throw new DecisionValidationError(
        `choice "${result.choice}" is not in the declared space [${question.choices.join(', ')}] for "${question.id}"`,
      );
    }
    for (const key of Object.keys(result.probabilities)) {
      if (!question.choices.includes(key)) {
        throw new DecisionValidationError(
          `probability key "${key}" is outside the declared space for "${question.id}"`,
        );
      }
    }
  }
  if (question.kind === 'score' && result.kind === 'score') {
    const min = question.min ?? 0;
    const max = question.max ?? 1;
    if (result.score < min || result.score > max) {
      throw new DecisionValidationError(
        `score ${result.score} out of [${min}, ${max}] for "${question.id}"`,
      );
    }
  }
}
