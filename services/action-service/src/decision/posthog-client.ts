import { PostHog } from "posthog-node";
import {
  PostHogDecisionSink,
  noopDecisionAnalyticsSink,
  type DecisionAnalyticsSink,
} from "./analytics-sink.js";

/**
 * Composition-root factory for the decision-plane analytics sink (ADR-010
 * Phase 3). This is the ONE module coupled to the PostHog SDK; everything else
 * depends on the vendor-neutral seam.
 *
 * Safe default: with no server-side POSTHOG_API_KEY the sink is a no-op — no
 * client, no requests — mirroring the Revenue Copilot Phase-1 default. The key
 * is the server-side project key (POSTHOG_API_KEY), never the browser
 * NEXT_PUBLIC_* key.
 */
/** https, or http only to a loopback host (local dev / self-host). */
function isSecureHost(host: string): boolean {
  try {
    const url = new URL(host);
    if (url.protocol === "https:") return true;
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "::1")
    );
  } catch {
    return false; // unparseable host ⇒ treat as insecure
  }
}

export function createDecisionAnalyticsSink(
  env: NodeJS.ProcessEnv = process.env,
): DecisionAnalyticsSink {
  const apiKey = env.POSTHOG_API_KEY;
  if (!apiKey) return noopDecisionAnalyticsSink;

  const host = env.POSTHOG_HOST ?? "https://us.i.posthog.com";
  // Decision metadata crosses the trust boundary here — refuse to ship it in
  // cleartext. Allow http only for a loopback host (local dev / self-host).
  if (!isSecureHost(host)) {
    console.warn(
      `[analytics] POSTHOG_HOST "${host}" is not https and not loopback — ` +
        `decision analytics disabled to avoid cleartext egress.`,
    );
    return noopDecisionAnalyticsSink;
  }

  const client = new PostHog(apiKey, {
    host,
    // Small buffer + short interval: this is low-volume governance telemetry,
    // and we would rather ship promptly than hold events for a full batch.
    flushAt: 20,
    flushInterval: 10_000,
  });
  return new PostHogDecisionSink(
    client,
    env.POSTHOG_DECISION_DISTINCT_ID ?? "aion-action-service",
  );
}
