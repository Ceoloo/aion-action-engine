import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertPermission, hasPermission, permissionsForRole } from "./index.js";
import { createExecutionContext } from "@aion/core";

describe("@aion/permissions", () => {
  it("grants operator permissions", () => {
    const ctx = createExecutionContext({
      actor: "ceo",
      actorType: "human",
      permissions: permissionsForRole("operator"),
    });
    assert.equal(hasPermission(ctx, "actions:approve"), true);
    assert.equal(hasPermission(ctx, "context:build"), true);
    assert.doesNotThrow(() => assertPermission(ctx, "actions:execute"));
  });

  it("blocks viewers from approve", () => {
    const ctx = createExecutionContext({
      actor: "guest",
      actorType: "human",
      permissions: permissionsForRole("viewer"),
    });
    assert.throws(() => assertPermission(ctx, "actions:approve"));
  });
});
