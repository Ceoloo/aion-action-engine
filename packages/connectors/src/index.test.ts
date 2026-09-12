import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { revenueSignalToAction, revenueCopilotEventToAction } from "./index.js";

describe("@aion/connectors", () => {
  it("maps buying-intent signals to call actions", () => {
    const input = revenueSignalToAction({
      entityId: "lead_102",
      signal: "high_buying_intent",
      confidence: 0.91,
      reasons: ["proposal_viewed_3x", "recent_reply", "urgent_cash_need"],
      recommendedAction: "call_now",
    });
    assert.equal(input.action_type, "call");
    assert.ok((input.priority ?? 0) >= 80);
    assert.equal(input.source, "revenue_signal_engine");
  });

  it("maps Revenue Copilot stalled application to follow-up", () => {
    const input = revenueCopilotEventToAction({
      eventType: "application_stalled",
      leadId: "lead_302",
      leadName: "James",
      hoursStale: 48,
      confidence: 0.9,
      details: ["Application incomplete for 48 hours", "Missing bank statements"],
      draftMessage: "Hi James — quick nudge on the remaining bank statements.",
    });
    assert.equal(input.source, "revenue_copilot");
    assert.equal(input.action_type, "follow_up");
    assert.ok((input.priority ?? 0) >= 85);
    assert.ok(input.tags?.includes("revenue_copilot"));
  });
});
