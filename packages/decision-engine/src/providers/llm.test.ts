import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LLMDecisionProvider,
  renderInstruction,
  type LLMJudge,
  type LLMJudgeOutput,
} from './llm.js';
import type {
  BinaryQuestion,
  ChoiceQuestion,
  DecisionState,
} from '../schemas/decision.js';

const state: DecisionState = { features: {} };

function judgeReturning(output: LLMJudgeOutput): LLMJudge {
  return { complete: async () => output };
}

const choiceQ: ChoiceQuestion = {
  id: 'stage',
  kind: 'choice',
  prompt: 'Stage?',
  choices: ['discovery', 'qualification', 'docs'],
};

describe('LLMDecisionProvider', () => {
  it('renders a constrained instruction listing the valid choices', () => {
    const text = renderInstruction(choiceQ);
    assert.match(text, /discovery, qualification, docs/);
  });

  it('parses a valid choice answer', async () => {
    const p = new LLMDecisionProvider({
      judge: judgeReturning({ choice: 'qualification', confidence: 0.82 }),
    });
    const [r] = await p.evaluate(state, [choiceQ]);
    assert.equal((r as { choice: string }).choice, 'qualification');
    assert.ok(Math.abs(r!.confidence - 0.82) < 1e-9);
  });

  it('collapses an out-of-space answer to a low-confidence fallback (no leak)', async () => {
    const p = new LLMDecisionProvider({
      judge: judgeReturning({ choice: 'i think maybe negotiation stage', confidence: 0.95 }),
      fallbackConfidence: 0.2,
    });
    const [r] = await p.evaluate(state, [choiceQ]);
    // Still a valid, in-space choice, but marked untrustworthy so policy escalates.
    assert.ok(choiceQ.choices.includes((r as { choice: string }).choice));
    assert.equal(r!.confidence, 0.2);
  });

  it('parses a binary answer and defaults confidence when unreported', async () => {
    const bq: BinaryQuestion = { id: 'dm', kind: 'binary', prompt: 'DM?' };
    const p = new LLMDecisionProvider({
      judge: judgeReturning({ choice: 'yes' }),
      defaultConfidence: 0.7,
    });
    const [r] = await p.evaluate(state, [bq]);
    assert.equal((r as { choice: boolean }).choice, true);
    assert.equal(r!.confidence, 0.7);
  });

  it('prefers a probability distribution when the judge returns one', async () => {
    const p = new LLMDecisionProvider({
      judge: judgeReturning({
        probabilities: { discovery: 0.1, qualification: 0.2, docs: 0.7 },
      }),
    });
    const [r] = await p.evaluate(state, [choiceQ]);
    assert.equal((r as { choice: string }).choice, 'docs');
  });
});
