import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateShadow } from './calibration.js';
import type { DecisionRecord } from '../telemetry/decision-record.js';
import type { DecisionRoute } from '../policy/thresholds.js';

let seq = 0;
function rec(p: {
  confidence: number;
  selected: string | boolean;
  truth?: string | boolean;
  route?: DecisionRoute;
  override?: string | boolean;
  latencyMs?: number;
  cost?: number;
}): DecisionRecord {
  seq += 1;
  const r: DecisionRecord = {
    decisionId: `dec_${seq}`,
    provider: 'rules',
    stateHash: 'h',
    decisionType: 'binary',
    questionId: 'q',
    selectedChoice: p.selected,
    confidence: p.confidence,
    route: p.route ?? 'llm_verify',
    createdAt: new Date().toISOString(),
  };
  if (p.truth !== undefined) r.groundTruth = p.truth;
  if (p.override !== undefined) r.humanOverride = { choice: p.override, by: 'ceo', at: 'now' };
  if (p.latencyMs !== undefined) r.latencyMs = p.latencyMs;
  if (p.cost !== undefined) r.cost = p.cost;
  return r;
}

describe('evaluateShadow', () => {
  it('computes overall accuracy over scored records', () => {
    const report = evaluateShadow([
      rec({ confidence: 0.9, selected: true, truth: true }),
      rec({ confidence: 0.9, selected: true, truth: false }),
      rec({ confidence: 0.9, selected: false, truth: false }),
    ]);
    assert.equal(report.scored, 3);
    assert.ok(Math.abs(report.accuracy - 2 / 3) < 1e-9);
  });

  it('places records into confidence buckets with per-bucket accuracy', () => {
    const report = evaluateShadow([
      rec({ confidence: 0.72, selected: true, truth: false }), // [0.7,0.8) wrong
      rec({ confidence: 0.74, selected: true, truth: true }), // [0.7,0.8) right
      rec({ confidence: 0.98, selected: true, truth: true }), // [0.95,1] right
    ]);
    const b78 = report.buckets.find((b) => b.lower === 0.7)!;
    assert.equal(b78.count, 2);
    assert.equal(b78.accuracy, 0.5);
    const b95 = report.buckets.find((b) => b.lower === 0.95)!;
    assert.equal(b95.count, 1);
    assert.equal(b95.accuracy, 1);
  });

  it('reports a non-zero expected calibration error when over-confident', () => {
    // Confidence ~0.95 but only 50% correct → miscalibrated.
    const report = evaluateShadow([
      rec({ confidence: 0.96, selected: true, truth: true }),
      rec({ confidence: 0.96, selected: true, truth: false }),
    ]);
    assert.ok(report.expectedCalibrationError > 0.4);
  });

  it('measures human disagreement rate', () => {
    const report = evaluateShadow([
      rec({ confidence: 0.9, selected: true, override: true }), // agree
      rec({ confidence: 0.9, selected: true, override: false }), // disagree
    ]);
    assert.equal(report.humanDisagreementRate, 0.5);
  });

  it('measures false automation rate among auto-routed decisions', () => {
    const report = evaluateShadow([
      rec({ confidence: 0.99, selected: true, truth: true, route: 'auto_execute' }),
      rec({ confidence: 0.99, selected: true, truth: false, route: 'auto_execute' }),
      rec({ confidence: 0.6, selected: true, truth: false, route: 'reasoning' }),
    ]);
    assert.equal(report.falseAutomationRate, 0.5); // 1 of 2 auto decisions wrong
    assert.ok(Math.abs(report.autoRouteRate - 2 / 3) < 1e-9);
    assert.equal(report.llmCallsAvoided, 2);
  });

  it('computes latency percentiles and total cost', () => {
    const report = evaluateShadow([
      rec({ confidence: 0.9, selected: true, latencyMs: 100, cost: 1 }),
      rec({ confidence: 0.9, selected: true, latencyMs: 200, cost: 2 }),
      rec({ confidence: 0.9, selected: true, latencyMs: 500, cost: 3 }),
    ]);
    assert.equal(report.totalCost, 6);
    assert.equal(report.latencyP50, 200);
    assert.equal(report.latencyP95, 500);
  });

  it('handles an empty batch without dividing by zero', () => {
    const report = evaluateShadow([]);
    assert.equal(report.total, 0);
    assert.equal(report.accuracy, 0);
    assert.equal(report.expectedCalibrationError, 0);
  });
});
