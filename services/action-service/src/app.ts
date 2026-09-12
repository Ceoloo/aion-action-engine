import { Hono } from "hono";
import { cors } from "hono/cors";
import { createExecutionContext } from "@aion/core";
import { permissionsForRole, PermissionError } from "@aion/permissions";
import {
  revenueCopilotEventToAction,
  type RevenueCopilotEvent,
} from "@aion/connectors";
import type { ActionEngine } from "./engine.js";

function actorFromHeaders(c: {
  req: { header: (name: string) => string | undefined };
}) {
  const actor = c.req.header("x-aion-actor") ?? "operator";
  const role = c.req.header("x-aion-role") ?? "operator";
  const actorTypeHeader = c.req.header("x-aion-actor-type");
  const actorType =
    actorTypeHeader === "agent" || actorTypeHeader === "system" ? actorTypeHeader : "human";
  return createExecutionContext({
    actor,
    actorType,
    permissions: permissionsForRole(role),
  });
}

export function createApp(engine: ActionEngine) {
  const app = new Hono();
  app.use("*", cors());

  app.get("/health", (c) =>
    c.json({ ok: true, service: "action-service", version: engine.version })
  );

  app.get("/v1/meta", (c) =>
    c.json({
      name: engine.name,
      version: engine.version,
      inputSchema: engine.inputSchema,
      outputSchema: engine.outputSchema,
      events: engine.events,
      permissions: engine.permissions,
      methods: [
        "createAction",
        "claimAction",
        "approveAction",
        "executeAction",
        "completeAction",
        "recordOutcome",
        "buildContext",
        "ingestRevenueCopilotEvent",
      ],
      producers: ["revenue_copilot"],
      consumers: ["operator_console", "agent_os"],
    })
  );

  app.get("/v1/actions", (c) => {
    const bucket = c.req.query("bucket");
    if (bucket) {
      const groups = engine.buckets();
      const key = bucket as keyof typeof groups;
      return c.json({ actions: groups[key] ?? [] });
    }
    return c.json({ actions: engine.listActions() });
  });

  app.get("/v1/actions/buckets", (c) => {
    const groups = engine.buckets();
    return c.json({
      buckets: groups,
      counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
    });
  });

  app.get("/v1/actions/:id", (c) => {
    const action = engine.getAction(c.req.param("id"));
    if (!action) return c.json({ error: "Not found" }, 404);
    const contextPack = action.context_pack_id
      ? engine.getContextPack(action.context_pack_id)
      : null;
    return c.json({ action, events: engine.getEvents(action.id), contextPack });
  });

  app.post("/v1/actions", async (c) => {
    try {
      const body = await c.req.json();
      const action = await engine.createAction(body, actorFromHeaders(c));
      return c.json({ action }, 201);
    } catch (err) {
      return handleError(c, err);
    }
  });

  /** Revenue Copilot → Action Queue producer endpoint */
  app.post("/v1/producers/revenue-copilot/events", async (c) => {
    try {
      const body = (await c.req.json()) as RevenueCopilotEvent;
      if (!body?.eventType || !body?.leadId) {
        return c.json({ error: "eventType and leadId are required" }, 400);
      }
      const ctx = actorFromHeaders(c);
      const producerCtx =
        c.req.header("x-aion-role") != null
          ? ctx
          : createExecutionContext({
              actor: c.req.header("x-aion-actor") ?? "revenue_copilot",
              actorType: "agent",
              permissions: permissionsForRole("producer"),
            });
      const input = revenueCopilotEventToAction(body);
      const action = await engine.createAction(input, producerCtx);
      return c.json({ action, producer: "revenue_copilot" }, 201);
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/v1/actions/:id/claim", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { claimedBy?: string };
      const ctx = actorFromHeaders(c);
      const action = await engine.claim(
        c.req.param("id"),
        body.claimedBy ?? ctx.actor,
        ctx
      );
      return c.json({ action });
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/v1/actions/:id/approve", async (c) => {
    try {
      const body = (await c.req.json()) as { approve?: boolean; approvedBy?: string };
      const ctx = actorFromHeaders(c);
      const action = await engine.approve(
        c.req.param("id"),
        body.approvedBy ?? ctx.actor,
        body.approve !== false,
        ctx
      );
      return c.json({ action });
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/v1/actions/:id/execute", async (c) => {
    try {
      const result = await engine.executeAction(c.req.param("id"), actorFromHeaders(c));
      return c.json(result);
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/v1/actions/:id/complete", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        status?: "completed" | "failed" | "cancelled";
      };
      const action = await engine.complete(
        c.req.param("id"),
        body.status ?? "completed",
        actorFromHeaders(c)
      );
      return c.json({ action });
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/v1/actions/:id/outcome", async (c) => {
    try {
      const body = await c.req.json();
      const ctx = actorFromHeaders(c);
      const action = await engine.recordOutcome(
        c.req.param("id"),
        {
          result: body.result,
          notes: body.notes,
          metrics: body.metrics,
          recordedAt: body.recordedAt ?? new Date().toISOString(),
          recordedBy: body.recordedBy ?? ctx.actor,
        },
        ctx
      );
      return c.json({ action });
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/v1/context/build", async (c) => {
    try {
      const body = await c.req.json();
      const ctx = actorFromHeaders(c);
      const contextPack = await engine.buildContext(
        {
          actor: body.actor ?? ctx.actor,
          task: body.task,
          entityType: body.entityType,
          entityId: body.entityId,
          actionId: body.actionId,
        },
        ctx
      );
      return c.json({ contextPack }, 201);
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.get("/v1/context/:id", (c) => {
    const contextPack = engine.getContextPack(c.req.param("id"));
    if (!contextPack) return c.json({ error: "Not found" }, 404);
    return c.json({ contextPack });
  });

  app.get("/v1/events", (c) => {
    const actionId = c.req.query("actionId");
    return c.json({ events: engine.getEvents(actionId) });
  });

  return app;
}

function handleError(
  c: { json: (body: unknown, status?: number) => Response },
  err: unknown
) {
  if (err instanceof PermissionError) {
    return c.json({ error: err.message }, 403);
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  const status = message.includes("not found") || message.includes("Not found") ? 404 : 400;
  return c.json({ error: message }, status);
}
