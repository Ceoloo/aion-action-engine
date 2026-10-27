import type { ExecutionContext } from "@aion/action-core";
import { createExecutionContext } from "@aion/action-core";
import { permissionsForRole } from "@aion/permissions";

/**
 * Authenticated principal bound to a server-issued bearer token.
 *
 * Permissions come ONLY from this server-side binding. Client headers such as
 * `x-aion-role` must never elevate privileges (satellite of AION Core — not a
 * second authority).
 */
export type BoundPrincipal = {
  actor: string;
  actorType: "human" | "agent" | "system";
  role: string;
  tenantId?: string;
};

export class AuthError extends Error {
  readonly status: 401 | 503;

  constructor(message: string, status: 401 | 503 = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export type PrincipalRecord = BoundPrincipal & { token: string };

/**
 * Load the principal registry from environment.
 *
 * Preferred: `AION_ACTION_AUTH_PRINCIPALS` JSON array:
 * ```json
 * [
 *   {
 *     "token": "…",
 *     "actor": "operator",
 *     "actorType": "human",
 *     "role": "operator",
 *     "tenantId": "tenant_aion"
 *   }
 * ]
 * ```
 *
 * Dev convenience: `AION_ACTION_DEV_TOKEN` maps to a local operator principal
 * (never use in production exposure).
 */
export function loadPrincipalRegistry(
  env: NodeJS.ProcessEnv = process.env
): Map<string, BoundPrincipal> {
  const map = new Map<string, BoundPrincipal>();

  const raw = env.AION_ACTION_AUTH_PRINCIPALS?.trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AuthError(
        "AION_ACTION_AUTH_PRINCIPALS is not valid JSON",
        503
      );
    }
    if (!Array.isArray(parsed)) {
      throw new AuthError(
        "AION_ACTION_AUTH_PRINCIPALS must be a JSON array",
        503
      );
    }
    for (const entry of parsed) {
      const record = normalizePrincipalRecord(entry);
      if (!record) continue;
      map.set(record.token, {
        actor: record.actor,
        actorType: record.actorType,
        role: record.role,
        tenantId: record.tenantId,
      });
    }
  }

  const devToken = env.AION_ACTION_DEV_TOKEN?.trim();
  if (devToken && env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
    throw new AuthError("AION_ACTION_DEV_TOKEN requires NODE_ENV=development or test", 503);
  }
  if (devToken && !map.has(devToken)) {
    map.set(devToken, {
      actor: env.AION_ACTION_DEV_ACTOR?.trim() || "local-operator",
      actorType: "human",
      role: env.AION_ACTION_DEV_ROLE?.trim() || "operator",
      tenantId: env.AION_ACTION_DEV_TENANT?.trim() || undefined,
    });
  }

  return map;
}

function normalizePrincipalRecord(entry: unknown): PrincipalRecord | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const token = typeof e.token === "string" ? e.token.trim() : "";
  const actor = typeof e.actor === "string" ? e.actor.trim() : "";
  const role = typeof e.role === "string" ? e.role.trim() : "";
  if (!token || !actor || !role) return null;
  const actorTypeRaw = e.actorType;
  const actorType =
    actorTypeRaw === "agent" || actorTypeRaw === "system" ? actorTypeRaw : "human";
  const tenantId =
    typeof e.tenantId === "string" && e.tenantId.trim()
      ? e.tenantId.trim()
      : undefined;
  return { token, actor, actorType, role, tenantId };
}

export type AuthResolver = {
  resolve(authorizationHeader: string | undefined): BoundPrincipal;
  size(): number;
};

export function createAuthResolver(
  registry: Map<string, BoundPrincipal> = loadPrincipalRegistry()
): AuthResolver {
  return {
    size: () => registry.size,
    resolve(authorizationHeader: string | undefined): BoundPrincipal {
      if (registry.size === 0) {
        throw new AuthError(
          "action-service auth is not configured (set AION_ACTION_AUTH_PRINCIPALS or AION_ACTION_DEV_TOKEN)",
          503
        );
      }
      if (!authorizationHeader) {
        throw new AuthError("missing Authorization bearer token");
      }
      const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim());
      if (!match) {
        throw new AuthError("Authorization must be Bearer <token>");
      }
      const token = match[1]!;
      const principal = registry.get(token);
      if (!principal) {
        throw new AuthError("invalid bearer token");
      }
      return principal;
    },
  };
}

export function executionContextForPrincipal(
  principal: BoundPrincipal
): ExecutionContext {
  return createExecutionContext({
    actor: principal.actor,
    actorType: principal.actorType,
    permissions: permissionsForRole(principal.role),
  });
}
