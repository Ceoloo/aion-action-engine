import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { revenueSignalToAction } from "./index.js";

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
});
