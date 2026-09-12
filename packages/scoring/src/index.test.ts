import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreAction, urgencyFromScore } from "./index.js";

describe("@aion/scoring", () => {
  it("scores urgent incomplete applications high", () => {
    const priority = scoreAction({
      urgency: "high",
      actionType: "follow_up",
      hoursStale: 48,
      buyingIntent: 0.5,
    });
    assert.ok(priority >= 85);
    assert.equal(urgencyFromScore(priority), "critical");
  });
});
