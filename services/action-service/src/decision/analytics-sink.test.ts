import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeCreateInput } from "@aion/actions";
import type { DecisionRecord } from "@aion/decision-engine";
import {
  PostHogDecisionSink,
  noopDecisionAnalyticsSink,
  recordedProperties,
  settledProperties,
  RECORDED_EVENT,
  SETTLED_EVENT,
  type AnalyticsClient,
  type DecisionAnalyticsSink,
} from "./analytics-sink.js";
import { ShadowDecisionRecorder } from "./shadow.js";

function baseRecord(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    decisionId: "dec_1",
    provider: "rules",
    stateHash: "h",
    decisionType: "binary",
    questionId: "approve_action",
    selectedChoice: true,
    confidence: 0.98,
    route: "auto_execute",
    createdAt: "2026-01-01T00:00:00.000Z",
    experimentKey: "thresholds",
    variant: "aggressive",
    ...overrides,
  };
}

/** Records every captured event; a `fail` flag makes capture throw (contract test). */
class FakeClient implements AnalyticsClient {
  captured: { distinctId: string; event: string; properties?: Record<string, unknown> }[] = [];
  shutdownCalls = 0;
  constructor(private readonly fail = false) {}
  capture(payload: { distinctId: string; event: string; properties?: Record<string, unknown> }) {
    if (this.fail) throw new Error("network down");
    this.captured.push(payload);
  }
  async shutdown() {
    this.shutdownCalls += 1;
  }
}

describe("decision analytics properties", () => {
  it("recorded properties carry calibration dimensions and no PII", () => {
    const props = recordedProperties(baseRecord());
    assert.equal(props.decision_id, "dec_1");
    assert.equal(props.route, "auto_execute");
    assert.equal(props.confidence, 0.98);
    assert.equal(props.experiment_key, "thresholds");
    assert.equal(props.variant, "aggressive");
    assert.ok(!("by" in props));
    assert.ok(!("humanOverride" in props));
  });

  it("settled properties compute agreement and never leak the deciding human", () => {
    // Shadow predicted true; human rejected → disagreement, and `by` is dropped.
    const rec = baseRecord({
      groundTruth: false,
      humanOverride: { choice: false, by: "ceo@example.com", at: "2026-01-01T00:00:00.000Z" },
    });
    const props = settledProperties(rec);
    assert.equal(props.ground_truth, false);
    assert.equal(props.agreed, false);
    assert.equal(props.selected_choice, true);
    // The username must never reach the analytics plane.
    assert.ok(!Object.values(props).includes("ceo@example.com"));
    assert.ok(!("by" in props));
    assert.equal(props.agreed !== undefined, true);
  });

  it("settled agreement is true when the human matched the shadow", () => {
    const props = settledProperties(baseRecord({ groundTruth: true }));
    assert.equal(props.agreed, true);
  });
});

describe("PostHogDecisionSink", () => {
  it("captures recorded and settled events with the configured distinct id", () => {
    const client = new FakeClient();
    const sink = new PostHogDecisionSink(client, "svc");
    sink.recorded(baseRecord());
    sink.settled(baseRecord({ groundTruth: true }));

    assert.equal(client.captured.length, 2);
    assert.deepEqual(
      client.captured.map((c) => [c.event, c.distinctId]),
      [
        [RECORDED_EVENT, "svc"],
        [SETTLED_EVENT, "svc"],
      ],
    );
  });

  it("swallows a client fault — the analytics plane never throws into control", () => {
    const sink = new PostHogDecisionSink(new FakeClient(true));
    assert.doesNotThrow(() => sink.recorded(baseRecord()));
    assert.doesNotThrow(() => sink.settled(baseRecord({ groundTruth: true })));
  });

  it("flush shuts the client down", async () => {
    const client = new FakeClient();
    await new PostHogDecisionSink(client).flush();
    assert.equal(client.shutdownCalls, 1);
  });
});

describe("ShadowDecisionRecorder → sink", () => {
  it("emits recorded on observe and settled on settle", async () => {
    const events: string[] = [];
    const sink: DecisionAnalyticsSink = {
      recorded: () => events.push("recorded"),
      settled: () => events.push("settled"),
      flush: async () => {},
    };
    const rec = new ShadowDecisionRecorder({ sink });
    const action = normalizeCreateInput({
      source: "revenue_copilot",
      entity_type: "lead",
      entity_id: "lead_1",
      action_type: "follow_up",
      title: "Follow up",
      reason: "test",
      priority: 95,
      urgency: "low",
    });

    await rec.observe(action);
    rec.settle(action.id, true, "ceo");
    assert.deepEqual(events, ["recorded", "settled"]);
  });

  it("defaults to the no-op sink (no analytics configured)", async () => {
    const rec = new ShadowDecisionRecorder(); // no sink
    const action = normalizeCreateInput({
      source: "revenue_copilot",
      entity_type: "lead",
      entity_id: "lead_2",
      action_type: "follow_up",
      title: "Follow up",
      reason: "test",
    });
    // Must not throw, and flush is a safe no-op.
    await rec.observe(action);
    rec.settle(action.id, true, "ceo");
    await rec.flush();
    assert.equal(noopDecisionAnalyticsSink.recorded(baseRecord()), undefined);
  });
});
