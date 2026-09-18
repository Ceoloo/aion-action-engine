import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionRecord, hashState } from './decision-record.js';
import type { ChoiceQuestion, ChoiceResult, DecisionState } from '../schemas/decision.js';

const question: ChoiceQuestion = {
  id: 'next_action',
  kind: 'choice',
  prompt: 'Next?',
  choices: ['request_documents', 'follow_up'],
};
const result: ChoiceResult = {
  questionId: 'next_action',
  kind: 'choice',
  choice: 'request_documents',
  confidence: 0.96,
  probabilities: { request_documents: 0.96, follow_up: 0.04 },
};
const state: DecisionState = {
  features: { intent: 0.9 },
  tenantId: 'tenant-a',
  missionId: 'msn_1',
};

describe('createDecisionRecord', () => {
  it('captures the full decision with a prefixed id and state hash', () => {
    const rec = createDecisionRecord({
      question,
      result,
      provider: 'typesafe-jev',
      route: 'auto_execute',
      state,
      risk: 'R1',
      policyThreshold: 0.97,
      latencyMs: 42,
      cost: 0.00004,
      executionResult: 'shadow',
    });
    assert.match(rec.decisionId, /^dec_/);
    assert.equal(rec.provider, 'typesafe-jev');
    assert.equal(rec.decisionType, 'choice');
    assert.deepEqual(rec.possibleChoices, question.choices);
    assert.equal(rec.selectedChoice, 'request_documents');
    assert.equal(rec.confidence, 0.96);
    assert.equal(rec.route, 'auto_execute');
    assert.equal(rec.policyThreshold, 0.97);
    assert.equal(rec.executionResult, 'shadow');
    assert.equal(rec.tenantId, 'tenant-a');
    assert.equal(rec.missionId, 'msn_1');
    assert.equal(rec.latencyMs, 42);
    assert.equal(typeof rec.stateHash, 'string');
    assert.equal(rec.stateHash.length, 64);
  });

  it('hashState is stable across key order', () => {
    const a = hashState({ features: { a: 1, b: 2 } });
    const b = hashState({ features: { b: 2, a: 1 } });
    assert.equal(a, b);
  });

  it('hashState changes when state changes', () => {
    const a = hashState({ features: { a: 1 } });
    const b = hashState({ features: { a: 2 } });
    assert.notEqual(a, b);
  });
});
