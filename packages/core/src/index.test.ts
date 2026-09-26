import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createExecutionContext, createRequestId } from "./index.js";

describe("@aion/action-core", () => {
  it("creates request ids", () => {
    assert.match(createRequestId(), /^req_/);
  });

  it("builds execution context", () => {
    const ctx = createExecutionContext({
      actor: "operator",
      actorType: "human",
      permissions: ["actions:read"],
    });
    assert.equal(ctx.actor, "operator");
    assert.match(ctx.requestId, /^req_/);
  });
});
