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
 * TypeSafe Jev provider (System-One) — scaffold.
 *
 * Jev returns a typed decision + probabilities rather than free text, e.g.
 *
 *   { "choice": "request_documents", "confidence": 0.96,
 *     "probabilities": { "request_documents": 0.96, "follow_up": 0.03, … } }
 *
 * This provider maps AION's typed questions onto that shape. The network call is
 * intentionally inert until credentials are supplied: {@link evaluate} throws a
 * clear error when unconfigured, so nothing silently depends on an external,
 * brand-new API. The response→result mapping ({@link mapJevResponse}) is a pure
 * function, unit-tested against Jev's documented shape without any network.
 *
 * Adopt the architecture, not the vendor: everything here sits behind
 * {@link DecisionProvider} so Jev can be swapped for another System-One model.
 */
export interface JevResponse {
  /** Chosen label (choice questions) or "true"/"false" (binary). */
  choice?: string;
  /** Numeric answer (score questions). */
  score?: number;
  confidence: number;
  probabilities?: Record<string, number>;
}

export interface TypeSafeJevConfig {
  /** API key. When absent, the provider is a documented seam and refuses calls. */
  apiKey?: string;
  /** Base URL of the Jev API. Configure per TypeSafe / Cloudflare Workers AI. */
  baseUrl?: string;
  /** Model id (e.g. a pinned Jev version). Recorded on decisions. */
  model?: string;
  /** Injectable fetch for testing / custom transports. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Request timeout in ms. Default 2000 (Jev latency is ~70–500 ms). */
  timeoutMs?: number;
}

export class TypeSafeJevProvider implements DecisionProvider {
  readonly name = 'typesafe-jev';
  readonly modelVersion?: string;
  private readonly config: TypeSafeJevConfig;

  constructor(config: TypeSafeJevConfig = {}) {
    this.config = config;
    this.modelVersion = config.model;
  }

  /** True when an API key is present and live calls are permitted. */
  get isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async evaluate(
    state: DecisionState,
    questions: DecisionQuestion[],
  ): Promise<DecisionResult[]> {
    if (!this.isConfigured) {
      throw new DecisionProviderError(
        this.name,
        'TypeSafe Jev is not configured (no apiKey). This provider is a seam: ' +
          'supply credentials and an allowed network egress to enable live calls, ' +
          'or use RulesProvider / LLMDecisionProvider in shadow mode.',
      );
    }
    const fetchImpl = this.config.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new DecisionProviderError(this.name, 'no fetch implementation available');
    }
    return Promise.all(
      questions.map((q) => this.evaluateOne(fetchImpl, state, q)),
    );
  }

  private async evaluateOne(
    fetchImpl: typeof fetch,
    state: DecisionState,
    question: DecisionQuestion,
  ): Promise<DecisionResult> {
    const body = buildJevRequest(state, question, this.config.model);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 2000,
    );
    let response: Response;
    try {
      response = await fetchImpl(this.endpoint(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new DecisionProviderError(
        this.name,
        `request failed for "${question.id}": ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new DecisionProviderError(
        this.name,
        `Jev returned ${response.status} for "${question.id}"`,
      );
    }
    const json = (await response.json()) as JevResponse;
    const result = mapJevResponse(question, json);
    assertResultValid(question, result);
    return result;
  }

  private endpoint(): string {
    const base = (this.config.baseUrl ?? 'https://api.typesafe.ai').replace(
      /\/$/,
      '',
    );
    return `${base}/v1/decide`;
  }
}

/** Build the request payload for a single Jev decision. */
export function buildJevRequest(
  state: DecisionState,
  question: DecisionQuestion,
  model?: string,
): Record<string, unknown> {
  const common = {
    model,
    prompt: question.prompt,
    state: state.features,
  };
  switch (question.kind) {
    case 'binary':
      return { ...common, type: 'binary' };
    case 'choice':
      return { ...common, type: 'choice', choices: question.choices };
    case 'score':
      return {
        ...common,
        type: 'score',
        min: question.min ?? 0,
        max: question.max ?? 1,
      };
  }
}

/**
 * Map a documented Jev response into a validated {@link DecisionResult}. Pure and
 * network-free — this is what the unit tests exercise. Out-of-space or malformed
 * responses throw, so a bad upstream answer never becomes a silent decision.
 */
export function mapJevResponse(
  question: DecisionQuestion,
  response: JevResponse,
): DecisionResult {
  const confidence = clampConfidence(response.confidence);
  switch (question.kind) {
    case 'binary': {
      const truthy = parseBinary(response);
      if (truthy === undefined) {
        throw new DecisionProviderError(
          'typesafe-jev',
          `binary response for "${question.id}" had no usable choice`,
        );
      }
      const pTrue = response.probabilities?.['true'];
      const probabilities =
        pTrue !== undefined
          ? { true: clampConfidence(pTrue), false: clampConfidence(1 - pTrue) }
          : truthy
            ? { true: confidence, false: 1 - confidence }
            : { true: 1 - confidence, false: confidence };
      return {
        questionId: question.id,
        kind: 'binary',
        choice: truthy,
        confidence,
        probabilities,
      };
    }
    case 'choice': {
      if (response.probabilities) {
        const restricted: Record<string, number> = {};
        for (const c of question.choices) {
          restricted[c] = Math.max(0, response.probabilities[c] ?? 0);
        }
        const sum = Object.values(restricted).reduce((a, b) => a + b, 0);
        if (sum > 0) {
          const probabilities = normalizeProbabilities(restricted);
          const top = argmax(probabilities);
          return {
            questionId: question.id,
            kind: 'choice',
            choice: top.choice,
            confidence: top.confidence,
            probabilities,
          };
        }
      }
      if (response.choice && question.choices.includes(response.choice)) {
        return {
          questionId: question.id,
          kind: 'choice',
          choice: response.choice,
          confidence,
          probabilities: { [response.choice]: confidence },
        };
      }
      throw new DecisionProviderError(
        'typesafe-jev',
        `choice "${response.choice}" is outside the declared space for "${question.id}"`,
      );
    }
    case 'score': {
      if (response.score === undefined || Number.isNaN(response.score)) {
        throw new DecisionProviderError(
          'typesafe-jev',
          `score response for "${question.id}" had no numeric score`,
        );
      }
      const min = question.min ?? 0;
      const max = question.max ?? 1;
      return {
        questionId: question.id,
        kind: 'score',
        score: Math.min(max, Math.max(min, response.score)),
        confidence,
      };
    }
  }
}

function parseBinary(response: JevResponse): boolean | undefined {
  if (response.choice !== undefined) {
    const v = response.choice.trim().toLowerCase();
    if (v === 'true' || v === 'yes') return true;
    if (v === 'false' || v === 'no') return false;
  }
  const pTrue = response.probabilities?.['true'];
  if (pTrue !== undefined) return pTrue >= 0.5;
  return undefined;
}
