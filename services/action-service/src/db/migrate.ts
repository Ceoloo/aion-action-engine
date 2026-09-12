import { migrate, openDb, getDbPath } from "./client.js";

const db = openDb();
migrate(db);
console.log(`Migrated database at ${getDbPath()}`);
db.close();
