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
 * The System-Two seam.
 *
 * An LLM can act as a decision provider (and, in the cascade, as the
 * verification / reasoning path a low-confidence System-One decision escalates
 * to). This provider is deliberately model-agnostic: it renders each question
 * into a constrained instruction, hands it to an injected {@link LLMJudge}, then
 * *parses and validates* the answer back into the typed decision space. It never
 * lets the model's free text leak downstream — an unparseable or out-of-space
 * answer collapses to a low-confidence result so the policy engine escalates
 * rather than acting on garbage.
 *
 * No concrete LLM client lives here. Callers inject a judge backed by whatever
 * model they use (Claude, GPT, Grok, …), keeping this package dependency-free.
 */
export interface LLMJudgeInput {
  question: DecisionQuestion;
  state: DecisionState;
  /** A rendered, constrained instruction the judge should answer. */
  instruction: string;
}

export interface LLMJudgeOutput {
  /** For choice: the chosen label. For binary: "true"/"false". */
  choice?: string;
  /** For score questions. */
  score?: number;
  /** Optional self-reported confidence in [0, 1]. */
  confidence?: number;
  /** Optional distribution over choice labels. */
  probabilities?: Record<string, number>;
}

export interface LLMJudge {
  complete(input: LLMJudgeInput): Promise<LLMJudgeOutput>;
}

export interface LLMDecisionProviderConfig {
  judge: LLMJudge;
  /** Confidence used when the judge does not report one. Default 0.7. */
  defaultConfidence?: number;
  /** Confidence assigned to a fallback when the answer is invalid. Default 0.2. */
  fallbackConfidence?: number;
  modelVersion?: string;
  name?: string;
}

export class LLMDecisionProvider implements DecisionProvider {
  readonly name: string;
  readonly modelVersion?: string;
  private readonly config: LLMDecisionProviderConfig;

  constructor(config: LLMDecisionProviderConfig) {
    this.config = config;
    this.name = config.name ?? 'llm';
    this.modelVersion = config.modelVersion;
  }

  async evaluate(
    state: DecisionState,
    questions: DecisionQuestion[],
  ): Promise<DecisionResult[]> {
    return Promise.all(questions.map((q) => this.evaluateOne(state, q)));
  }

  private async evaluateOne(
    state: DecisionState,
    question: DecisionQuestion,
  ): Promise<DecisionResult> {
    const instruction = renderInstruction(question);
    let output: LLMJudgeOutput;
    try {
      output = await this.config.judge.complete({ question, state, instruction });
    } catch (err) {
      throw new DecisionProviderError(
        this.name,
        `judge failed for "${question.id}": ${(err as Error).message}`,
      );
    }
    const result = this.parse(question, output);
    assertResultValid(question, result);
    return result;
  }

  private get defaultConfidence(): number {
    return this.config.defaultConfidence ?? 0.7;
  }

  private get fallbackConfidence(): number {
    return this.config.fallbackConfidence ?? 0.2;
  }

  private parse(
    question: DecisionQuestion,
    output: LLMJudgeOutput,
  ): DecisionResult {
    const reported =
      output.confidence !== undefined
        ? clampConfidence(output.confidence)
        : undefined;

    switch (question.kind) {
      case 'binary': {
        const truthy = parseBoolean(output.choice);
        if (truthy === undefined) return this.fallbackBinary(question);
        const conf = reported ?? this.defaultConfidence;
        return {
          questionId: question.id,
          kind: 'binary',
          choice: truthy,
          confidence: conf,
          probabilities: truthy
            ? { true: conf, false: 1 - conf }
            : { true: 1 - conf, false: conf },
        };
      }
      case 'choice': {
        if (output.probabilities) {
          const restricted: Record<string, number> = {};
          for (const c of question.choices) {
            restricted[c] = Math.max(0, output.probabilities[c] ?? 0);
          }
          const sum = Object.values(restricted).reduce((a, b) => a + b, 0);
          if (sum > 0) {
            const probabilities = normalizeProbabilities(restricted);
            const { choice, confidence } = argmax(probabilities);
            return {
              questionId: question.id,
              kind: 'choice',
              choice,
              confidence,
              probabilities,
            };
          }
        }
        if (output.choice && question.choices.includes(output.choice)) {
          const conf = reported ?? this.defaultConfidence;
          const rest =
            question.choices.length > 1
              ? (1 - conf) / (question.choices.length - 1)
              : 0;
          const probabilities: Record<string, number> = {};
          for (const c of question.choices) {
            probabilities[c] = c === output.choice ? conf : rest;
          }
          return {
            questionId: question.id,
            kind: 'choice',
            choice: output.choice,
            confidence: conf,
            probabilities,
          };
        }
        return this.fallbackChoice(question);
      }
      case 'score': {
        if (output.score === undefined || Number.isNaN(output.score)) {
          return this.fallbackScore(question);
        }
        const min = question.min ?? 0;
        const max = question.max ?? 1;
        return {
          questionId: question.id,
          kind: 'score',
          score: Math.min(max, Math.max(min, output.score)),
          confidence: reported ?? this.defaultConfidence,
        };
      }
    }
  }

  private fallbackBinary(question: DecisionQuestion): DecisionResult {
    const c = this.fallbackConfidence;
    return {
      questionId: question.id,
      kind: 'binary',
      choice: false,
      confidence: c,
      probabilities: { true: 1 - c, false: c },
    };
  }

  private fallbackChoice(question: DecisionQuestion): DecisionResult {
    const choices = (question as { choices: string[] }).choices;
    const probabilities = normalizeProbabilities(
      Object.fromEntries(choices.map((c) => [c, 1])),
    );
    const { choice } = argmax(probabilities);
    return {
      questionId: question.id,
      kind: 'choice',
      choice,
      confidence: this.fallbackConfidence,
      probabilities,
    };
  }

  private fallbackScore(question: DecisionQuestion): DecisionResult {
    const min = (question as { min?: number }).min ?? 0;
    const max = (question as { max?: number }).max ?? 1;
    return {
      questionId: question.id,
      kind: 'score',
      score: (min + max) / 2,
      confidence: this.fallbackConfidence,
    };
  }
}

/** Render a question into a constrained instruction for a judge. */
export function renderInstruction(question: DecisionQuestion): string {
  switch (question.kind) {
    case 'binary':
      return `${question.prompt}\nAnswer strictly "true" or "false".`;
    case 'choice':
      return `${question.prompt}\nAnswer with exactly one of: ${question.choices.join(', ')}.`;
    case 'score': {
      const min = question.min ?? 0;
      const max = question.max ?? 1;
      return `${question.prompt}\nAnswer with a single number between ${min} and ${max}.`;
    }
  }
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === 'yes' || v === '1') return true;
  if (v === 'false' || v === 'no' || v === '0') return false;
  return undefined;
}
