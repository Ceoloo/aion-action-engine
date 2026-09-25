import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TypeSafeJevProvider,
  buildJevRequest,
  mapJevResponse,
} from './typesafe.js';
import { DecisionProviderError } from './provider.js';
import type {
  BinaryQuestion,
  ChoiceQuestion,
  ScoreQuestion,
  DecisionState,
} from '../schemas/decision.js';

const state: DecisionState = { features: { transcript: '…' } };

const choiceQ: ChoiceQuestion = {
  id: 'next_action',
  kind: 'choice',
  prompt: 'Next action?',
  choices: ['request_documents', 'follow_up', 'nurture'],
};

describe('TypeSafeJevProvider (seam)', () => {
  it('refuses live calls when unconfigured', async () => {
    const p = new TypeSafeJevProvider();
    assert.equal(p.isConfigured, false);
    await assert.rejects(
      () => p.evaluate(state, [choiceQ]),
      DecisionProviderError,
    );
  });

  it('reports configured when an apiKey is present', () => {
    const p = new TypeSafeJevProvider({ apiKey: 'sk-test' });
    assert.equal(p.isConfigured, true);
  });

  it('calls the injected fetch and maps a live-shaped response', async () => {
    const jev = {
      choice: 'request_documents',
      confidence: 0.96,
      probabilities: { request_documents: 0.96, follow_up: 0.03, nurture: 0.01 },
    };
    const fetchImpl = (async () =>
      new Response(JSON.stringify(jev), { status: 200 })) as unknown as typeof fetch;
    const p = new TypeSafeJevProvider({ apiKey: 'sk', fetchImpl });
    const [r] = await p.evaluate(state, [choiceQ]);
    assert.equal((r as { choice: string }).choice, 'request_documents');
    assert.ok(Math.abs(r!.confidence - 0.96) < 1e-9);
  });

  it('throws on a non-200 from Jev', async () => {
    const fetchImpl = (async () =>
      new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const p = new TypeSafeJevProvider({ apiKey: 'sk', fetchImpl });
    await assert.rejects(() => p.evaluate(state, [choiceQ]), DecisionProviderError);
  });
});

describe('buildJevRequest', () => {
  it('encodes choice questions with their choices', () => {
    const body = buildJevRequest(state, choiceQ, 'jev-1') as Record<string, unknown>;
    assert.equal(body.type, 'choice');
    assert.deepEqual(body.choices, choiceQ.choices);
    assert.equal(body.model, 'jev-1');
  });

  it('encodes score bounds', () => {
    const sq: ScoreQuestion = { id: 'u', kind: 'score', prompt: 'Urgency', min: 0, max: 10 };
    const body = buildJevRequest(state, sq) as Record<string, unknown>;
    assert.equal(body.type, 'score');
    assert.equal(body.min, 0);
    assert.equal(body.max, 10);
  });
});

describe('mapJevResponse — pure, network-free', () => {
  it('maps a choice response and picks argmax from probabilities', () => {
    const r = mapJevResponse(choiceQ, {
      choice: 'follow_up',
      confidence: 0.5,
      probabilities: { request_documents: 0.9, follow_up: 0.1 },
    });
    // argmax over probabilities wins over the stated choice.
    assert.equal((r as { choice: string }).choice, 'request_documents');
  });

  it('rejects an out-of-space choice with no probabilities', () => {
    assert.throws(
      () => mapJevResponse(choiceQ, { choice: 'invent', confidence: 0.99 }),
      DecisionProviderError,
    );
  });

  it('maps a binary response from "true"/"false"', () => {
    const bq: BinaryQuestion = { id: 'dm', kind: 'binary', prompt: 'DM?' };
    const r = mapJevResponse(bq, { choice: 'true', confidence: 0.88 });
    assert.equal((r as { choice: boolean }).choice, true);
    assert.ok(Math.abs(r.confidence - 0.88) < 1e-9);
  });

  it('maps a binary response from a probability of true', () => {
    const bq: BinaryQuestion = { id: 'dm', kind: 'binary', prompt: 'DM?' };
    const r = mapJevResponse(bq, { confidence: 0.7, probabilities: { true: 0.3, false: 0.7 } });
    assert.equal((r as { choice: boolean }).choice, false);
  });

  it('clamps a score into bounds', () => {
    const sq: ScoreQuestion = { id: 'u', kind: 'score', prompt: 'Urgency', min: 0, max: 1 };
    const r = mapJevResponse(sq, { score: 1.9, confidence: 0.8 });
    assert.equal((r as { score: number }).score, 1);
  });
});
