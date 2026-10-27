import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createExecutionContext } from "@aion/action-core";
import { permissionsForRole } from "@aion/permissions";
import { migrate, openDb } from "./db/client.js";
import { ActionRepository } from "./db/repository.js";
import { ActionEngine } from "./engine.js";
import { createApp } from "./app.js";
import {
  AuthError,
  createAuthResolver,
  loadPrincipalRegistry,
} from "./auth.js";

describe("action-service auth boundary", () => {
  const operatorToken = "test-operator-token";
  const viewerToken = "test-viewer-token";
  const producerToken = "test-producer-token";

  const auth = createAuthResolver(
    new Map([
      [
        operatorToken,
        {
          actor: "test-operator",
          actorType: "human",
          role: "operator",
          tenantId: "tenant_test",
        },
      ],
      [
        viewerToken,
        {
          actor: "test-viewer",
          actorType: "human",
          role: "viewer",
        },
      ],
      [
        producerToken,
        {
          actor: "revenue_copilot",
          actorType: "agent",
          role: "producer",
        },
      ],
    ])
  );

  function makeApp() {
    const dbPath = path.join(os.tmpdir(), `aion-actions-auth-${Date.now()}-${Math.random()}.db`);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const db = openDb(dbPath);
    migrate(db);
    const engine = new ActionEngine(new ActionRepository(db));
    return createApp(engine, { auth });
  }

  it("rejects unauthenticated reads", async () => {
    const app = makeApp();
    const res = await app.request("/v1/actions");
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /bearer/i);
  });

  it("denies unauthenticated access across every API route", async () => {
    const app = makeApp();
    const reads = ["meta", "actions", "actions/buckets", "actions/missing", "context/missing", "events", "decisions", "decisions/shadow/report"];
    const writes = ["actions", "producers/revenue-copilot/events", "actions/missing/claim", "actions/missing/approve", "actions/missing/execute", "actions/missing/complete", "actions/missing/outcome", "context/build"];
    for (const route of reads) assert.equal((await app.request(`/v1/${route}`)).status, 401, route);
    for (const route of writes) assert.equal((await app.request(`/v1/${route}`, { method: "POST" })).status, 401, route);
  });

  it("ignores client-supplied x-aion-role elevation", async () => {
    const app = makeApp();
    // Viewer token + forged admin role header must remain viewer (no approve).
    const create = await app.request("/v1/actions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${operatorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: "test",
        entity_type: "lead",
        entity_id: "lead_auth",
        action_type: "follow_up",
        title: "Auth boundary check",
        reason: "test",
        priority: 10,
        urgency: "low",
        requires_approval: true,
      }),
    });
    assert.equal(create.status, 201);
    const { action } = (await create.json()) as { action: { id: string } };

    const forged = await app.request(`/v1/actions/${action.id}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${viewerToken}`,
        "content-type": "application/json",
        "x-aion-role": "admin",
        "x-aion-actor": "ceo",
      },
      body: JSON.stringify({ approve: true }),
    });
    assert.equal(forged.status, 403);
    const approved = await app.request(`/v1/actions/${action.id}/approve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${operatorToken}`, "content-type": "application/json" },
      body: JSON.stringify({ approve: true, approvedBy: "forged-ceo" }),
    });
    assert.equal(approved.status, 200);
    const accepted = await approved.json() as { action: { approved_by: string } };
    assert.equal(accepted.action.approved_by, "test-operator");
  });

  it("binds producer permissions from token, not headers", async () => {
    const app = makeApp();
    const res = await app.request("/v1/producers/revenue-copilot/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${producerToken}`,
        "content-type": "application/json",
        // Forged operator role must not matter.
        "x-aion-role": "operator",
      },
      body: JSON.stringify({
        eventType: "application_stalled",
        leadId: "lead_auth_2",
        leadName: "Auth",
        hoursStale: 24,
        confidence: 0.8,
        details: ["test"],
      }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { action: { id: string }; producer: string };
    assert.equal(body.producer, "revenue_copilot");
    assert.match(body.action.id, /^act_/);

    // Producer cannot approve.
    const approve = await app.request(`/v1/actions/${body.action.id}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${producerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ approve: true }),
    });
    assert.equal(approve.status, 403);
  });

  it("health remains public and reports authConfigured", async () => {
    const app = makeApp();
    const res = await app.request("/health");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { authConfigured: boolean };
    assert.equal(body.authConfigured, true);
  });

  it("fails closed when no principals are configured", async () => {
    const empty = createAuthResolver(new Map());
    const dbPath = path.join(os.tmpdir(), `aion-actions-empty-auth-${Date.now()}.db`);
    const db = openDb(dbPath);
    migrate(db);
    const app = createApp(new ActionEngine(new ActionRepository(db)), { auth: empty });
    const res = await app.request("/v1/actions", {
      headers: { Authorization: "Bearer anything" },
    });
    assert.equal(res.status, 503);
  });

  it("loads principal registry from JSON env", () => {
    const registry = loadPrincipalRegistry({
      AION_ACTION_AUTH_PRINCIPALS: JSON.stringify([
        {
          token: "abc",
          actor: "ops",
          actorType: "human",
          role: "operator",
          tenantId: "t1",
        },
      ]),
    });
    assert.equal(registry.get("abc")?.tenantId, "t1");
    assert.equal(registry.get("abc")?.role, "operator");
  });

  it("rejects dev credentials outside explicit development/test mode", () => {
    for (const NODE_ENV of [undefined, "production", "staging"]) {
      assert.throws(() => loadPrincipalRegistry({ NODE_ENV, AION_ACTION_DEV_TOKEN: "dev-token" }), AuthError);
    }
    assert.equal(loadPrincipalRegistry({ NODE_ENV: "development", AION_ACTION_DEV_TOKEN: "dev-token" }).size, 1);
  });

  it("rejects invalid bearer format", () => {
    const resolver = createAuthResolver(
      new Map([["tok", { actor: "a", actorType: "human", role: "viewer" }]])
    );
    assert.throws(() => resolver.resolve("Token tok"), AuthError);
  });
});

describe("engine still uses explicit ExecutionContext in unit paths", () => {
  it("creates actions with injected context (bypass HTTP)", async () => {
    const dbPath = path.join(os.tmpdir(), `aion-actions-engine-ctx-${Date.now()}.db`);
    const db = openDb(dbPath);
    migrate(db);
    const engine = new ActionEngine(new ActionRepository(db));
    const ctx = createExecutionContext({
      actor: "unit",
      actorType: "system",
      permissions: permissionsForRole("admin"),
    });
    const action = await engine.createAction(
      {
        source: "unit",
        entity_type: "lead",
        entity_id: "lead_unit",
        action_type: "follow_up",
        title: "unit",
        reason: "unit",
        priority: 1,
        urgency: "low",
        requires_approval: false,
      },
      ctx
    );
    assert.match(action.id, /^act_/);
  });
});
