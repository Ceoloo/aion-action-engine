import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContextPackBuilder, assembleContextPack } from "./index.js";
import { createExecutionContext } from "@aion/action-core";

describe("@aion/context", () => {
  it("assembles a context pack for a lead follow-up", () => {
    const pack = assembleContextPack({
      actor: "revenue-agent",
      task: "prepare_followup",
      entityType: "lead",
      entityId: "lead_302",
    });
    assert.match(pack.id, /^ctx_/);
    assert.equal(pack.identity.displayName, "James B");
    assert.ok(pack.applicable_playbooks.length >= 1);
    assert.ok(pack.recommended_context_window.maxTokens > 0);
  });

  it("exposes AionTool execute()", async () => {
    const builder = new ContextPackBuilder();
    const ctx = createExecutionContext({
      actor: "system",
      actorType: "system",
      permissions: ["context:build"],
    });
    const pack = await builder.execute(
      {
        actor: "revenue-agent",
        task: "prepare_followup",
        entityType: "lead",
        entityId: "lead_302",
        actionId: "act_01",
      },
      ctx
    );
    assert.equal(builder.get(pack.id)?.action_id, "act_01");
  });
});
