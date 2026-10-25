import { config } from "./config.js";
import { PostgresStore } from "./store.js";
const c = config();
if (!c.DATABASE_URL) throw new Error("DATABASE_URL is required");
const store = new PostgresStore(c.DATABASE_URL);
try {
  await store.migrate();
  console.log("Database migrations complete");
} finally {
  await store.close();
}
