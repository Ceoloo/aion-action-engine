import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeDecision,
  isAutonomousRoute,
  DEFAULT_THRESHOLD_POLICY,
} from './thresholds.js';

describe('routeDecision — confidence + risk → route', () => {
  it('sends any high-risk (R3) action to a human regardless of confidence', () => {
    const r = routeDecision({ confidence: 0.999, risk: 'R3' });
    assert.equal(r.route, 'human_approval');
  });

  it('auto-executes very high confidence at low risk', () => {
    const r = routeDecision({ confidence: 0.98, risk: 'R1' });
    assert.equal(r.route, 'auto_execute');
    assert.equal(r.threshold, DEFAULT_THRESHOLD_POLICY.autoExecute);
  });

  it('auto-executes low-risk in the 0.90–0.97 band', () => {
    const r = routeDecision({ confidence: 0.92, risk: 'R0' });
    assert.equal(r.route, 'auto_execute_low_risk');
  });

  it('escalates the 0.90–0.97 band to verify when risk is moderate (R2)', () => {
    const r = routeDecision({ confidence: 0.92, risk: 'R2' });
    assert.equal(r.route, 'llm_verify');
  });

  it('routes the 0.75–0.90 band to llm_verify', () => {
    const r = routeDecision({ confidence: 0.8, risk: 'R1' });
    assert.equal(r.route, 'llm_verify');
  });

  it('routes below 0.75 to reasoning', () => {
    const r = routeDecision({ confidence: 0.6, risk: 'R1' });
    assert.equal(r.route, 'reasoning');
  });

  it('respects a tenant policy override (e.g. gate R2 to humans)', () => {
    const r = routeDecision({
      confidence: 0.99,
      risk: 'R2',
      policy: { humanApprovalRisk: 'R2' },
    });
    assert.equal(r.route, 'human_approval');
  });

  it('isAutonomousRoute flags only the auto paths', () => {
    assert.equal(isAutonomousRoute('auto_execute'), true);
    assert.equal(isAutonomousRoute('auto_execute_low_risk'), true);
    assert.equal(isAutonomousRoute('llm_verify'), false);
    assert.equal(isAutonomousRoute('human_approval'), false);
  });
});
