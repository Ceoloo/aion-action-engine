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
    const executed = await engine.executeAction(action.id, ctx);
    assert.equal(executed.status, "executing");
    const done = await engine.complete(action.id, "completed", ctx);
    assert.equal(done.status, "completed");
  });
});
