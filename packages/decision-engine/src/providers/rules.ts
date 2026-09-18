import {
  argmax,
  assertResultValid,
  clampConfidence,
  normalizeProbabilities,
  type DecisionQuestion,
  type DecisionResult,
  type DecisionState,
} from '../schemas/decision.js';
import { DecisionProviderError, type DecisionProvider } from './provider.js';

/**
 * A rule returns either a raw signal or a final answer for a question:
 *  - binary: a probability of `true` in [0, 1], or a boolean.
 *  - choice: a probability map over choices, or a single chosen label.
 *  - score:  a number (clamped to the question bounds).
 */
export type BinaryRule = (state: DecisionState) => number | boolean;
export type ChoiceRule = (
  state: DecisionState,
) => Record<string, number> | string;
export type ScoreRule = (state: DecisionState) => number;

export interface RulesConfig {
  binary?: Record<string, BinaryRule>;
  choice?: Record<string, ChoiceRule>;
  score?: Record<string, ScoreRule>;
  /** Confidence assigned when a rule returns a bare label/boolean. Default 0.8. */
  defaultConfidence?: number;
  /**
   * Confidence for a question with no matching rule. Default 0.5 (a deliberate
   * "unsure" so the policy engine escalates rather than acting). Set to throw
   * instead with {@link RulesConfig.strict}.
   */
  missingConfidence?: number;
  /** When true, a question with no rule throws instead of returning "unsure". */
  strict?: boolean;
  modelVersion?: string;
}

/**
 * Deterministic decision provider.
 *
 * The always-available baseline and the fastest path: given the same state it
 * returns the same decision, with no model and no network. It is the natural
 * shadow comparison for a probabilistic provider and the fallback when no
 * external provider is configured.
 */
export class RulesProvider implements DecisionProvider {
  readonly name = 'rules';
  readonly modelVersion?: string;
  private readonly config: RulesConfig;

  constructor(config: RulesConfig = {}) {
    this.config = config;
    this.modelVersion = config.modelVersion;
  }

  async evaluate(
    state: DecisionState,
    questions: DecisionQuestion[],
  ): Promise<DecisionResult[]> {
    return questions.map((q) => this.evaluateOne(state, q));
  }

  private get defaultConfidence(): number {
    return this.config.defaultConfidence ?? 0.8;
  }

  private evaluateOne(
    state: DecisionState,
    question: DecisionQuestion,
  ): DecisionResult {
    const result = this.compute(state, question);
    assertResultValid(question, result);
    return result;
  }

  private compute(
    state: DecisionState,
    question: DecisionQuestion,
  ): DecisionResult {
    switch (question.kind) {
      case 'binary': {
        const rule = this.config.binary?.[question.id];
        if (!rule) return this.missingBinary(question);
        const raw = rule(state);
        const pTrue =
          typeof raw === 'boolean'
            ? raw
              ? this.defaultConfidence
              : 1 - this.defaultConfidence
            : clampConfidence(raw);
        const choice = pTrue >= 0.5;
        return {
          questionId: question.id,
          kind: 'binary',
          choice,
          confidence: clampConfidence(choice ? pTrue : 1 - pTrue),
          probabilities: { true: pTrue, false: 1 - pTrue },
        };
      }
      case 'choice': {
        const rule = this.config.choice?.[question.id];
        if (!rule) return this.missingChoice(question);
        const raw = rule(state);
        const probabilities =
          typeof raw === 'string'
            ? this.labelToProbabilities(question.choices, raw)
            : normalizeProbabilities(
                this.restrictToChoices(question.choices, raw),
              );
        const { choice, confidence } = argmax(probabilities);
        return {
          questionId: question.id,
          kind: 'choice',
          choice,
          confidence,
          probabilities,
        };
      }
      case 'score': {
        const rule = this.config.score?.[question.id];
        if (!rule) return this.missingScore(question);
        const min = question.min ?? 0;
        const max = question.max ?? 1;
        const score = Math.min(max, Math.max(min, rule(state)));
        return {
          questionId: question.id,
          kind: 'score',
          score,
          confidence: this.defaultConfidence,
        };
      }
    }
  }

  private labelToProbabilities(
    choices: string[],
    label: string,
  ): Record<string, number> {
    if (!choices.includes(label)) {
      throw new DecisionProviderError(
        this.name,
        `rule returned "${label}" which is not a declared choice`,
      );
    }
    const conf = this.defaultConfidence;
    const rest = choices.length > 1 ? (1 - conf) / (choices.length - 1) : 0;
    const out: Record<string, number> = {};
    for (const c of choices) out[c] = c === label ? conf : rest;
    return out;
  }

  private restrictToChoices(
    choices: string[],
    raw: Record<string, number>,
  ): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of choices) out[c] = Math.max(0, raw[c] ?? 0);
    return out;
  }

  private missingBinary(question: DecisionQuestion): DecisionResult {
    this.assertNotStrict(question.id);
    const c = this.config.missingConfidence ?? 0.5;
    return {
      questionId: question.id,
      kind: 'binary',
      choice: false,
      confidence: c,
      probabilities: { true: 1 - c, false: c },
    };
  }

  private missingChoice(question: DecisionQuestion): DecisionResult {
    this.assertNotStrict(question.id);
    const choices = (question as { choices: string[] }).choices;
    const probabilities = normalizeProbabilities(
      Object.fromEntries(choices.map((c) => [c, 1])),
    );
    const { choice, confidence } = argmax(probabilities);
    return {
      questionId: question.id,
      kind: 'choice',
      choice,
      confidence,
      probabilities,
    };
  }

  private missingScore(question: DecisionQuestion): DecisionResult {
    this.assertNotStrict(question.id);
    const min = (question as { min?: number }).min ?? 0;
    const max = (question as { max?: number }).max ?? 1;
    return {
      questionId: question.id,
      kind: 'score',
      score: (min + max) / 2,
      confidence: this.config.missingConfidence ?? 0.5,
    };
  }

  private assertNotStrict(questionId: string): void {
    if (this.config.strict) {
      throw new DecisionProviderError(
        this.name,
        `no rule configured for question "${questionId}" (strict mode)`,
      );
    }
  }
}
