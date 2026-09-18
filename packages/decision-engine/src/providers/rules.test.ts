import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RulesProvider } from './rules.js';
import { DecisionProviderError } from './provider.js';
import type {
  BinaryQuestion,
  ChoiceQuestion,
  ScoreQuestion,
  DecisionState,
} from '../schemas/decision.js';

const state: DecisionState = { features: { hoursStale: 48, intent: 0.9 } };

describe('RulesProvider', () => {
  it('evaluates a binary rule returning a probability', async () => {
    const p = new RulesProvider({
      binary: { dm: (s) => (s.features.intent as number) },
    });
    const q: BinaryQuestion = { id: 'dm', kind: 'binary', prompt: 'Decision maker?' };
    const [r] = await p.evaluate(state, [q]);
    assert.equal(r!.kind, 'binary');
    assert.equal((r as { choice: boolean }).choice, true);
    assert.ok(r!.confidence > 0.85);
  });

  it('maps a bare choice label to a distribution', async () => {
    const q: ChoiceQuestion = {
      id: 'stage',
      kind: 'choice',
      prompt: 'Stage?',
      choices: ['discovery', 'qualification', 'docs'],
    };
    const p = new RulesProvider({
      choice: { stage: () => 'docs' },
      defaultConfidence: 0.8,
    });
    const [r] = await p.evaluate(state, [q]);
    assert.equal((r as { choice: string }).choice, 'docs');
    assert.equal(r!.confidence, 0.8);
  });

  it('restricts a probability map to declared choices and renormalizes', async () => {
    const q: ChoiceQuestion = {
      id: 'stage',
      kind: 'choice',
      prompt: 'Stage?',
      choices: ['a', 'b'],
    };
    const p = new RulesProvider({
      // "c" is not a declared choice and must be dropped.
      choice: { stage: () => ({ a: 3, b: 1, c: 99 }) },
    });
    const [r] = await p.evaluate(state, [q]);
    const cr = r as { choice: string; probabilities: Record<string, number> };
    assert.equal(cr.choice, 'a');
    assert.ok(!('c' in cr.probabilities));
    assert.ok(Math.abs(cr.probabilities.a! - 0.75) < 1e-9);
  });

  it('clamps a score to the question bounds', async () => {
    const q: ScoreQuestion = { id: 'urg', kind: 'score', prompt: 'Urgency', min: 0, max: 1 };
    const p = new RulesProvider({ score: { urg: () => 2.5 } });
    const [r] = await p.evaluate(state, [q]);
    assert.equal((r as { score: number }).score, 1);
  });

  it('returns a low-confidence "unsure" for a missing rule so policy escalates', async () => {
    const q: BinaryQuestion = { id: 'unknown', kind: 'binary', prompt: '?' };
    const p = new RulesProvider({});
    const [r] = await p.evaluate(state, [q]);
    assert.equal(r!.confidence, 0.5);
  });

  it('throws in strict mode when a rule is missing', async () => {
    const q: BinaryQuestion = { id: 'unknown', kind: 'binary', prompt: '?' };
    const p = new RulesProvider({ strict: true });
    await assert.rejects(() => p.evaluate(state, [q]), DecisionProviderError);
  });

  it('is deterministic: same state → same decision', async () => {
    const q: ScoreQuestion = { id: 'urg', kind: 'score', prompt: 'Urgency', min: 0, max: 100 };
    const p = new RulesProvider({ score: { urg: (s) => (s.features.hoursStale as number) } });
    const [a] = await p.evaluate(state, [q]);
    const [b] = await p.evaluate(state, [q]);
    assert.deepEqual(a, b);
  });
});
