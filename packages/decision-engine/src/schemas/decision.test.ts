import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  argmax,
  assertResultValid,
  clampConfidence,
  normalizeProbabilities,
  selectedValue,
  DecisionValidationError,
  type ChoiceQuestion,
  type ChoiceResult,
  type ScoreQuestion,
} from './decision.js';

describe('decision schemas', () => {
  it('clamps confidence into [0,1] and handles NaN', () => {
    assert.equal(clampConfidence(1.5), 1);
    assert.equal(clampConfidence(-0.2), 0);
    assert.equal(clampConfidence(Number.NaN), 0);
    assert.equal(clampConfidence(0.42), 0.42);
  });

  it('normalizes probabilities to sum 1', () => {
    const n = normalizeProbabilities({ a: 3, b: 1 });
    assert.equal(n.a, 0.75);
    assert.equal(n.b, 0.25);
  });

  it('makes an all-zero map uniform', () => {
    const n = normalizeProbabilities({ a: 0, b: 0, c: 0 });
    assert.ok(Math.abs(n.a! - 1 / 3) < 1e-9);
  });

  it('argmax picks the top key and its probability', () => {
    const { choice, confidence } = argmax({ x: 0.2, y: 0.7, z: 0.1 });
    assert.equal(choice, 'y');
    assert.equal(confidence, 0.7);
  });

  it('selectedValue normalizes across kinds', () => {
    assert.equal(
      selectedValue({
        questionId: 'q',
        kind: 'binary',
        choice: true,
        confidence: 0.9,
        probabilities: { true: 0.9, false: 0.1 },
      }),
      true,
    );
  });

  describe('assertResultValid — the structural guarantee', () => {
    const q: ChoiceQuestion = {
      id: 'stage',
      kind: 'choice',
      prompt: 'Stage?',
      choices: ['discovery', 'qualification', 'closed'],
    };

    it('accepts an in-space choice', () => {
      const r: ChoiceResult = {
        questionId: 'stage',
        kind: 'choice',
        choice: 'qualification',
        confidence: 0.8,
        probabilities: { qualification: 0.8, discovery: 0.2 },
      };
      assert.doesNotThrow(() => assertResultValid(q, r));
    });

    it('rejects a choice outside the declared space (no hallucinated output)', () => {
      const r: ChoiceResult = {
        questionId: 'stage',
        kind: 'choice',
        choice: 'negotiation',
        confidence: 0.99,
        probabilities: { negotiation: 0.99 },
      };
      assert.throws(() => assertResultValid(q, r), DecisionValidationError);
    });

    it('rejects a probability key outside the space', () => {
      const r: ChoiceResult = {
        questionId: 'stage',
        kind: 'choice',
        choice: 'discovery',
        confidence: 0.6,
        probabilities: { discovery: 0.6, invented: 0.4 },
      };
      assert.throws(() => assertResultValid(q, r), DecisionValidationError);
    });

    it('rejects a score outside bounds', () => {
      const sq: ScoreQuestion = { id: 'u', kind: 'score', prompt: 'Urgency?', min: 0, max: 1 };
      assert.throws(
        () =>
          assertResultValid(sq, {
            questionId: 'u',
            kind: 'score',
            score: 1.4,
            confidence: 0.7,
          }),
        DecisionValidationError,
      );
    });

    it('rejects a kind or id mismatch', () => {
      assert.throws(
        () =>
          assertResultValid(q, {
            questionId: 'stage',
            kind: 'binary',
            choice: true,
            confidence: 0.5,
            probabilities: { true: 0.5, false: 0.5 },
          }),
        DecisionValidationError,
      );
    });
  });
});
