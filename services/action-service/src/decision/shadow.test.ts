import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeCreateInput, type CreateActionInput } from "@aion/actions";
import type { ActionObject } from "@aion/core";
import {
  ShadowDecisionRecorder,
  approvalProbability,
  actionDecisionState,
  APPROVE_QUESTION,
} from "./shadow.js";

function action(overrides: Partial<CreateActionInput> = {}): ActionObject {
  return normalizeCreateInput({
    source: "revenue_copilot",
    entity_type: "lead",
    entity_id: "lead_1",
    action_type: "follow_up",
    title: "Follow up",
    reason: "test",
    priority: 60,
    urgency: "medium",
    requires_approval: true,
    ...overrides,
  });
}

describe("approvalProbability", () => {
  it("rises with priority and low urgency, clamped to [0,1]", () => {
    assert.equal(
      approvalProbability({ priority: 90, urgency: "low", action_type: "follow_up" }),
      1,
    ); // 0.9 + 0.1, clamped
    const mid = approvalProbability({ priority: 60, urgency: "medium" });
    assert.ok(mid > 0 && mid < 1);
  });

  it("leans away from auto-approve for urgent, outward actions", () => {
    const p = approvalProbability({
      priority: 40,
      urgency: "critical",
      action_type: "send_payment",
    });
    assert.equal(p, 0); // 0.4 - 0.3 - 0.25 → clamped to 0
  });

  it("uses safe defaults for missing features", () => {
    const p = approvalProbability({});
    assert.equal(p, 0.5); // priority 50, urgency medium
  });
});

describe("actionDecisionState", () => {
  it("projects non-PII features the provider can decide on", () => {
    const state = actionDecisionState(action({ priority: 77, urgency: "high" }));
    assert.equal(state.features.priority, 77);
    assert.equal(state.features.urgency, "high");
    assert.equal(state.features.action_type, "follow_up");
    assert.equal(state.features.entity_type, "lead");
  });
});

describe("ShadowDecisionRecorder", () => {
  it("records a shadow decision without executing", async () => {
    const rec = new ShadowDecisionRecorder();
    const a = action({ priority: 95, urgency: "low" });
    const record = await rec.observe(a);

    assert.ok(record);
    assert.equal(record!.questionId, APPROVE_QUESTION.id);
    assert.equal(record!.decisionType, "binary");
    assert.equal(record!.executionResult, "shadow"); // never acted on
    assert.equal(record!.selectedChoice, true); // high priority, low urgency
    assert.equal(rec.records().length, 1);
    assert.equal(record!.groundTruth, undefined); // not settled yet
  });

  it("settles the human decision as ground truth", async () => {
    const rec = new ShadowDecisionRecorder({ isoNow: () => "2026-01-01T00:00:00.000Z" });
    const a = action({ priority: 95, urgency: "low" }); // shadow picks approve=true
    await rec.observe(a);

    rec.settle(a.id, true, "ceo"); // human agrees
    const agreed = rec.recordFor(a.id)!;
    assert.equal(agreed.groundTruth, true);
    // The human decision is recorded even on agreement (it is authoritative).
    assert.deepEqual(agreed.humanOverride, {
      choice: true,
      by: "ceo",
      at: "2026-01-01T00:00:00.000Z",
    });

    // A human who disagrees is captured the same way, with the opposite choice.
    const b = action({ entity_id: "lead_2", priority: 95, urgency: "low" });
    await rec.observe(b);
    rec.settle(b.id, false, "ceo");
    const overridden = rec.recordFor(b.id)!;
    assert.equal(overridden.groundTruth, false);
    assert.deepEqual(overridden.humanOverride, {
      choice: false,
      by: "ceo",
      at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("computes a calibration report over settled records", async () => {
    const rec = new ShadowDecisionRecorder();
    const hi = action({ entity_id: "hi", priority: 95, urgency: "low" }); // → true
    const lo = action({ entity_id: "lo", priority: 40, urgency: "critical", action_type: "send_payment" }); // → false
    await rec.observe(hi);
    await rec.observe(lo);
    rec.settle(hi.id, true, "ceo"); // shadow right
    rec.settle(lo.id, true, "ceo"); // shadow wrong (predicted false)

    const report = rec.report();
    assert.equal(report.scored, 2);
    assert.equal(report.accuracy, 0.5);
    assert.equal(report.humanDisagreementRate, 0.5); // one override
  });

  it("never throws into the caller when the engine faults", async () => {
    const rec = new ShadowDecisionRecorder();
    // Simulate a Decision Plane fault — the observer must swallow it.
    (rec as unknown as { engine: { decide: () => Promise<never> } }).engine = {
      decide: async () => {
        throw new Error("boom");
      },
    };
    const result = await rec.observe(action());
    assert.equal(result, null);
    assert.equal(rec.records().length, 0);
  });
});
