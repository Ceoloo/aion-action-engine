import type { ExecutionContext, Permission } from "@aion/core";

export class PermissionError extends Error {
  constructor(
    public readonly required: Permission,
    public readonly actor: string
  ) {
    super(`Actor ${actor} missing permission ${required}`);
    this.name = "PermissionError";
  }
}

export function hasPermission(ctx: ExecutionContext, permission: Permission): boolean {
  return ctx.permissions.includes(permission) || ctx.permissions.includes("actions:admin");
}

export function assertPermission(ctx: ExecutionContext, permission: Permission): void {
  if (!hasPermission(ctx, permission)) {
    throw new PermissionError(permission, ctx.actor);
  }
}

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  operator: [
    "actions:create",
    "actions:read",
    "actions:claim",
    "actions:approve",
    "actions:execute",
    "actions:complete",
    "actions:outcome",
    "context:build",
    "context:read",
  ],
  agent: [
    "actions:create",
    "actions:read",
    "actions:claim",
    "actions:execute",
    "actions:complete",
    "actions:outcome",
    "context:build",
    "context:read",
  ],
  producer: ["actions:create", "actions:read"],
  viewer: ["actions:read", "context:read"],
  admin: ["actions:admin", "context:build", "context:read"],
};

export function permissionsForRole(role: string): Permission[] {
  return ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.viewer!;
}
