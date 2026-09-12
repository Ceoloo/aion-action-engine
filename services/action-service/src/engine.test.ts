import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createExecutionContext } from "@aion/core";
import { permissionsForRole } from "@aion/permissions";
import { migrate, openDb } from "./db/client.js";
import { ActionRepository } from "./db/repository.js";
import { ActionEngine } from "./engine.js";
import { createApp } from "./app.js";

describe("action-service", () => {
  let engine: ActionEngine;
  let app: ReturnType<typeof createApp>;

  before(() => {
    const dbPath = path.join(os.tmpdir(), `aion-actions-test-${Date.now()}.db`);
    process.env.AION_DB_PATH = dbPath;
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const db = openDb(dbPath);
    migrate(db);
    engine = new ActionEngine(new ActionRepository(db));
    app = createApp(engine);
  });

  it("creates and buckets actions via API", async () => {
    const ctx = createExecutionContext({
      actor: "test",
      actorType: "system",
      permissions: permissionsForRole("admin"),
    });

    const action = await engine.createAction(
      {
        source: "revenue_copilot",
        entity_type: "lead",
        entity_id: "lead_302",
        action_type: "follow_up",
        title: "Follow up with James about bank statements",
        reason: "Application incomplete for 48 hours",
        priority: 91,
        urgency: "high",
        requires_approval: true,
      },
      ctx
    );

    assert.match(action.id, /^act_/);
    assert.equal(engine.buckets().now.some((a) => a.id === action.id), true);

    const res = await app.request("/v1/actions/buckets");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { counts: Record<string, number> };
    assert.ok(body.counts.now >= 1);

    const approved = await engine.approve(action.id, "ceo", true, ctx);
    assert.equal(approved.status, "approved");

    const { action: executed, contextPack } = await engine.executeAction(action.id, ctx);
    assert.equal(executed.status, "executing");
    assert.ok(executed.context_pack_id);
    assert.equal(contextPack.id, executed.context_pack_id);
    assert.equal(contextPack.entity_id, "lead_302");
    assert.ok(contextPack.applicable_playbooks.length >= 1);

    const done = await engine.complete(action.id, "completed", ctx);
    assert.equal(done.status, "completed");
  });

  it("ingests Revenue Copilot events into the queue", async () => {
    const res = await app.request("/v1/producers/revenue-copilot/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-aion-actor": "revenue_copilot",
        "x-aion-role": "producer",
        "x-aion-actor-type": "agent",
      },
      body: JSON.stringify({
        eventType: "proposal_viewed",
        leadId: "lead_888",
        leadName: "Priya",
        confidence: 0.93,
        details: ["proposal_viewed_3x", "high_engagement"],
      }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as {
      action: { source: string; action_type: string; priority: number };
      producer: string;
    };
    assert.equal(body.producer, "revenue_copilot");
    assert.equal(body.action.source, "revenue_copilot");
    assert.equal(body.action.action_type, "call");
    assert.ok(body.action.priority >= 85);
  });
});
