import { serve } from "@hono/node-server";
import { migrate, openDb } from "./db/client.js";
import { ActionRepository } from "./db/repository.js";
import { ActionEngine } from "./engine.js";
import { ShadowDecisionRecorder } from "./decision/shadow.js";
import { createApp } from "./app.js";

const db = openDb();
migrate(db);
// Shadow-mode Decision Plane runs beside the approval gate (ADR-010 Phase 2):
// it records what auto-approve would have decided, never acting on it.
const recorder = new ShadowDecisionRecorder();
const engine = new ActionEngine(
  new ActionRepository(db),
  undefined,
  undefined,
  recorder
);
const app = createApp(engine);

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`AION Action Service listening on http://localhost:${info.port}`);
});
