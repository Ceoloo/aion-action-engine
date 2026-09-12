import { serve } from "@hono/node-server";
import { migrate, openDb } from "./db/client.js";
import { ActionRepository } from "./db/repository.js";
import { ActionEngine } from "./engine.js";
import { createApp } from "./app.js";

const db = openDb();
migrate(db);
const engine = new ActionEngine(new ActionRepository(db));
const app = createApp(engine);

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`AION Action Service listening on http://localhost:${info.port}`);
});
