import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createExecutionContext, createRequestId } from "./index.js";

describe("@aion/core", () => {
  it("creates request ids", () => {
    const id = createRequestId();
    assert.match(id, /^req_/);
  });

  it("builds execution context", () => {
    const ctx = createExecutionContext({
      actor: "operator",
      actorType: "human",
      permissions: ["actions:read"],
    });
    assert.equal(ctx.actor, "operator");
    assert.ok(ctx.requestId.startsWith("req_"));
  });
});
