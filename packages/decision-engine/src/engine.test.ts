import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DecisionEngine } from './engine.js';
import { RulesProvider } from './providers/rules.js';
import type { DecisionRecord } from './telemetry/decision-record.js';
import type {
  ChoiceQuestion,
  DecisionState,
  BinaryQuestion,
} from './schemas/decision.js';

const state: DecisionState = { features: { intent: 0.99 }, tenantId: 'tenant-a' };

const nextAction: ChoiceQuestion = {
  id: 'next_action',
  kind: 'choice',
  prompt: 'Next action?',
  choices: ['request_documents', 'follow_up', 'nurture'],
};

describe('DecisionEngine', () => {
  it('runs a provider, routes, and emits a record', async () => {
    const records: DecisionRecord[] = [];
    const engine = new DecisionEngine({
      provider: new RulesProvider({
        choice: { next_action: () => 'request_documents' },
        defaultConfidence: 0.98,
      }),
      onRecord: (r) => records.push(r),
    });
    const outcome = await engine.decide(state, nextAction, { risk: 'R1' });
    assert.equal((outcome.result as { choice: string }).choice, 'request_documents');
    assert.equal(outcome.route.route, 'auto_execute');
    assert.equal(records.length, 1);
    assert.equal(records[0]!.executionResult, 'pending');
    assert.equal(records[0]!.tenantId, 'tenant-a');
  });

  it('marks records as shadow in shadow mode and never claims execution', async () => {
    const engine = new DecisionEngine({
      provider: new RulesProvider({
        choice: { next_action: () => 'follow_up' },
        defaultConfidence: 0.99,
      }),
    });
    const outcome = await engine.decide(state, nextAction, {
      risk: 'R1',
      mode: 'shadow',
    });
    assert.equal(outcome.record.executionResult, 'shadow');
  });

  it('routes a high-risk decision to a human regardless of confidence', async () => {
    const engine = new DecisionEngine({
      provider: new RulesProvider({
        choice: { next_action: () => 'request_documents' },
        defaultConfidence: 1,
      }),
    });
    const outcome = await engine.decide(state, nextAction, { risk: 'R3' });
    assert.equal(outcome.route.route, 'human_approval');
  });

  it('decides many questions in one pass', async () => {
    const dm: BinaryQuestion = { id: 'dm', kind: 'binary', prompt: 'DM?' };
    const engine = new DecisionEngine({
      provider: new RulesProvider({
        binary: { dm: () => 0.9 },
        choice: { next_action: () => 'nurture' },
      }),
    });
    const outcomes = await engine.decideMany(state, [dm, nextAction], { risk: 'R1' });
    assert.equal(outcomes.length, 2);
    assert.equal(outcomes[0]!.record.questionId, 'dm');
    assert.equal(outcomes[1]!.record.questionId, 'next_action');
  });

  it('applies a custom threshold policy', async () => {
    const engine = new DecisionEngine({
      provider: new RulesProvider({
        choice: { next_action: () => 'follow_up' },
        defaultConfidence: 0.92,
      }),
      policy: { autoExecute: 0.9 },
    });
    // With autoExecute lowered to 0.90, a 0.92 confidence at R1 auto-executes.
    const outcome = await engine.decide(state, nextAction, { risk: 'R1' });
    assert.equal(outcome.route.route, 'auto_execute');
  });
});
