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
export function createDecisionAnalyticsSink(
  env: NodeJS.ProcessEnv = process.env,
): DecisionAnalyticsSink {
  const apiKey = env.POSTHOG_API_KEY;
  if (!apiKey) return noopDecisionAnalyticsSink;

  const client = new PostHog(apiKey, {
    host: env.POSTHOG_HOST ?? "https://us.i.posthog.com",
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
