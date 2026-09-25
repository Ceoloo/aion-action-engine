import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDecisionAnalyticsSink } from "./posthog-client.js";
import { noopDecisionAnalyticsSink } from "./analytics-sink.js";

describe("createDecisionAnalyticsSink", () => {
  it("is a no-op when no server-side key is set", () => {
    assert.equal(createDecisionAnalyticsSink({}), noopDecisionAnalyticsSink);
  });

  it("refuses a cleartext (non-loopback http) host — no-op instead of egress", () => {
    const sink = createDecisionAnalyticsSink({
      POSTHOG_API_KEY: "phc_test",
      POSTHOG_HOST: "http://analytics.example.com",
    });
    assert.equal(sink, noopDecisionAnalyticsSink);
  });

  it("builds a real sink for an https host", async () => {
    const sink = createDecisionAnalyticsSink({
      POSTHOG_API_KEY: "phc_test",
      POSTHOG_HOST: "https://us.i.posthog.com",
    });
    assert.notEqual(sink, noopDecisionAnalyticsSink);
    await sink.flush(); // shuts the client down cleanly (no events sent)
  });

  it("allows http only for a loopback host (local/self-host dev)", () => {
    const sink = createDecisionAnalyticsSink({
      POSTHOG_API_KEY: "phc_test",
      POSTHOG_HOST: "http://localhost:8000",
    });
    assert.notEqual(sink, noopDecisionAnalyticsSink);
  });
});
