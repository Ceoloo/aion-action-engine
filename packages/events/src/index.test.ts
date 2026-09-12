import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ActionEventEmitter } from "./index.js";
import type { ActionObject } from "@aion/core";

const sample: ActionObject = {
  id: "act_01",
  source: "test",
  entity_type: "lead",
  entity_id: "lead_1",
  action_type: "follow_up",
  title: "Test",
  reason: "Test",
  priority: 80,
  urgency: "high",
  suggested_action: { channel: "sms" },
  requires_approval: true,
  status: "queued",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("@aion/events", () => {
  it("emits and records events", async () => {
    const bus = new ActionEventEmitter();
    let seen = 0;
    bus.on("action.created", () => {
      seen += 1;
    });
    await bus.emit("action.created", sample, "system");
    assert.equal(seen, 1);
    assert.equal(bus.getHistory("act_01").length, 1);
  });
});
