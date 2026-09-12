import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bucketAction,
  canTransition,
  claimAction,
  normalizeCreateInput,
  approveAction,
  executeAction,
  completeAction,
} from "./index.js";

describe("@aion/actions", () => {
  it("normalizes create input with defaults", () => {
    const action = normalizeCreateInput({
      source: "revenue_copilot",
      entity_type: "lead",
      entity_id: "lead_302",
      action_type: "follow_up",
      title: "Follow up with James about bank statements",
      reason: "Application incomplete for 48 hours",
      priority: 91,
      urgency: "high",
    });
    assert.equal(action.priority, 91);
    assert.equal(action.status, "awaiting_approval");
    assert.match(action.id, /^act_/);
  });

  it("buckets high priority into now", () => {
    const action = normalizeCreateInput({
      source: "revenue_copilot",
      entity_type: "lead",
      entity_id: "lead_1",
      action_type: "follow_up",
      title: "Call now",
      reason: "Buying intent",
      priority: 91,
      urgency: "high",
      requires_approval: false,
    });
    assert.equal(bucketAction(action), "now");
  });

  it("runs approval → execute → complete lifecycle", () => {
    let action = normalizeCreateInput({
      source: "system",
      entity_type: "deploy",
      entity_id: "deploy_1",
      action_type: "review",
      title: "Review deploy",
      reason: "Production ready",
      requires_approval: true,
    });
    assert.equal(canTransition("awaiting_approval", "approved"), true);
    action = approveAction(action, "ceo", true);
    action = executeAction(action);
    action = completeAction(action);
    assert.equal(action.status, "completed");
    assert.ok(action.completed_at);
  });

  it("claims queued actions", () => {
    const action = normalizeCreateInput({
      source: "client_os",
      entity_type: "client",
      entity_id: "client_1",
      action_type: "onboard",
      title: "Prepare onboarding",
      reason: "Kickoff next week",
      requires_approval: false,
    });
    const claimed = claimAction(action, "operator");
    assert.equal(claimed.status, "claimed");
    assert.equal(claimed.claimed_by, "operator");
  });
});
