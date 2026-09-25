import { serve } from "@hono/node-server";
import { migrate, openDb } from "./db/client.js";
import { ActionRepository } from "./db/repository.js";
import { ActionEngine } from "./engine.js";
import { ShadowDecisionRecorder } from "./decision/shadow.js";
import { createDecisionAnalyticsSink } from "./decision/posthog-client.js";
import { createApp } from "./app.js";

const db = openDb();
migrate(db);
// Shadow-mode Decision Plane runs beside the approval gate (ADR-010 Phase 2):
// it records what auto-approve would have decided, never acting on it.
// The routing-threshold experiment is opt-in: with no `experiment` configured
// the recorder runs a single control arm (byVariant reports "(none) :: (control)").
// Pass ShadowRecorderOptions.experiment { provider, key, variants } to enroll
// actions into a threshold experiment once one is defined for this service.
//
// Phase 3: shadow records stream to the analytics plane via the injected sink.
// With no server-side POSTHOG_API_KEY the sink is a no-op (no client, no
// requests) — the same safe default as the Revenue Copilot Phase-1 wiring.
const analyticsSink = createDecisionAnalyticsSink();
const recorder = new ShadowDecisionRecorder({ sink: analyticsSink });
const engine = new ActionEngine(
  new ActionRepository(db),
  undefined,
  undefined,
  recorder
);
const app = createApp(engine);

const port = Number(process.env.PORT ?? 8787);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`AION Action Service listening on http://localhost:${info.port}`);
});

// Flush buffered analytics on shutdown so the last decisions are not lost.
let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, flushing analytics and shutting down…`);
  await recorder.flush();
  server.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
