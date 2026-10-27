import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ExecutionContext } from "@aion/action-core";
import { PermissionError, assertPermission } from "@aion/permissions";
import {
  revenueCopilotEventToAction,
  type RevenueCopilotEvent,
} from "@aion/connectors";
import type { ActionEngine } from "./engine.js";
import {
  AuthError,
  createAuthResolver,
  executionContextForPrincipal,
  type AuthResolver,
  type BoundPrincipal,
} from "./auth.js";

type AppVariables = {
  principal: BoundPrincipal;
  executionContext: ExecutionContext;
};

export type CreateAppOptions = {
  /**
   * Injected auth resolver (tests). Defaults to env-backed registry.
   * Caller-supplied `x-aion-role` headers are never consulted.
   */
  auth?: AuthResolver;
};

function requireCtx(c: { get: (k: "executionContext") => ExecutionContext }): ExecutionContext {
  return c.get("executionContext");
}

export function createApp(engine: ActionEngine, options: CreateAppOptions = {}) {
  const auth = options.auth ?? createAuthResolver();
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", cors());

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "action-service",
      version: engine.version,
      authConfigured: auth.size() > 0,
    })
  );

  // Fail closed: every /v1 route requires a server-bound bearer principal.
  app.use("/v1/*", async (c, next) => {
    try {
      const principal = auth.resolve(c.req.header("authorization"));
      c.set("principal", principal);
      c.set("executionContext", executionContextForPrincipal(principal));
      await next();
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.get("/v1/meta", (c) => {
    try {
      assertPermission(requireCtx(c), "actions:read");
      return c.json({
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
        auth: {
          mode: "bearer_principal",
          note: "Permissions are bound to the bearer token server-side; x-aion-role is ignored",
        },
      });
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.get("/v1/actions", (c) => {
    try {
      assertPermission(requireCtx(c), "actions:read");
      const bucket = c.req.query("bucket");
      if (bucket) {
        const groups = engine.buckets();
        const key = bucket as keyof typeof groups;
        return c.json({ actions: groups[key] ?? [] });
      }
      return c.json({ actions: engine.listActions() });
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.get("/v1/actions/buckets", (c) => {
    try {
      assertPermission(requireCtx(c), "actions:read");
      const groups = engine.buckets();
      return c.json({
        buckets: groups,
        counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
      });
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.get("/v1/actions/:id", (c) => {
    try {
      assertPermission(requireCtx(c), "actions:read");
      const action = engine.getAction(c.req.param("id"));
      if (!action) return c.json({ error: "Not found" }, 404);
      const contextPack = action.context_pack_id
        ? engine.getContextPack(action.context_pack_id)
        : null;
      return c.json({ action, events: engine.getEvents(action.id), contextPack });
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/v1/actions", async (c) => {
    try {
      const body = await c.req.json();
      const action = await engine.createAction(body, requireCtx(c));
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
      // Role comes from the bearer binding (expect producer/admin), not headers.
      assertPermission(requireCtx(c), "actions:create");
      const input = revenueCopilotEventToAction(body);
      const action = await engine.createAction(input, requireCtx(c));
      return c.json({ action, producer: "revenue_copilot" }, 201);
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/v1/actions/:id/claim", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({})) as { claimedBy?: string };
      const ctx = requireCtx(c);
      const action = await engine.claim(
        c.req.param("id"),
        ctx.actor,
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
      const ctx = requireCtx(c);
      const action = await engine.approve(
        c.req.param("id"),
        ctx.actor,
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
      const result = await engine.executeAction(c.req.param("id"), requireCtx(c));
      return c.json(result);
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/v1/actions/:id/complete", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({})) as {
        status?: "completed" | "failed" | "cancelled";
      };
      const action = await engine.complete(
        c.req.param("id"),
        body.status ?? "completed",
        requireCtx(c)
      );
      return c.json({ action });
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/v1/actions/:id/outcome", async (c) => {
    try {
      const body = await c.req.json();
      const ctx = requireCtx(c);
      const action = await engine.recordOutcome(
        c.req.param("id"),
        {
          result: body.result,
          notes: body.notes,
          metrics: body.metrics,
          recordedAt: body.recordedAt ?? new Date().toISOString(),
          recordedBy: ctx.actor,
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
      const ctx = requireCtx(c);
      const contextPack = await engine.buildContext(
        {
          actor: ctx.actor,
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
    try {
      assertPermission(requireCtx(c), "context:read");
      const contextPack = engine.getContextPack(c.req.param("id"));
      if (!contextPack) return c.json({ error: "Not found" }, 404);
      return c.json({ contextPack });
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.get("/v1/events", (c) => {
    try {
      assertPermission(requireCtx(c), "actions:read");
      const actionId = c.req.query("actionId");
      return c.json({ events: engine.getEvents(actionId) });
    } catch (err) {
      return handleError(c, err);
    }
  });

  /**
   * Decision Plane (shadow) — read-only. What auto-approve WOULD have decided at
   * the approval gate, scored against the human's actual decision. Never acts.
   * The ledger carries the deciding human (humanOverride.by), so both routes
   * require an authenticated reader with `actions:read`.
   */
  app.get("/v1/decisions", (c) => {
    try {
      assertPermission(requireCtx(c), "actions:read");
      return c.json({ mode: "shadow", records: engine.shadowRecords() });
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.get("/v1/decisions/shadow/report", (c) => {
    try {
      assertPermission(requireCtx(c), "actions:read");
      const byVariant = c.req.query("byVariant");
      if (byVariant === "true") {
        return c.json({ mode: "shadow", byVariant: engine.shadowReportByVariant() });
      }
      return c.json({ mode: "shadow", report: engine.shadowReport() });
    } catch (err) {
      return handleError(c, err);
    }
  });

  return app;
}

function handleError(
  c: { json: (body: unknown, status?: number) => Response },
  err: unknown
) {
  if (err instanceof AuthError) {
    return c.json({ error: err.message }, err.status);
  }
  if (err instanceof PermissionError) {
    return c.json({ error: err.message }, 403);
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  const status = message.includes("not found") || message.includes("Not found") ? 404 : 400;
  return c.json({ error: message }, status);
}
