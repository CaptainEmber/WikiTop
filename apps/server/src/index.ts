import { config } from "./config.js";
import { MemoryStore, PostgresStore } from "./store.js";
import { MemoryWiki, RemoteWiki } from "./wiki.js";
import { World } from "./world.js";
import { buildApp } from "./app.js";
import { seedDemo } from "./demo.js";
const c = config();
if (!c.DATABASE_URL && c.NODE_ENV === "production")
  throw new Error("PostgreSQL required");
const store = c.DATABASE_URL
  ? new PostgresStore(c.DATABASE_URL)
  : new MemoryStore();
if (store instanceof PostgresStore) await store.migrate();
if (c.WIKI_MODE === "memory" && store instanceof PostgresStore)
  throw new Error(
    "Memory wiki requires an ephemeral development store; omit DATABASE_URL",
  );
const wiki = c.WIKI_MODE === "memory" ? new MemoryWiki() : new RemoteWiki(c);
const state = await store.read();
if (
  Object.values(state.publications).some(
    (p) => (p.scene as { schemaVersion: number }).schemaVersion !== 2,
  )
)
  throw new Error(
    "Legacy Y-up publications detected. Stop play and run pnpm migrate:coordinates before starting this version.",
  );
const world = new World(store, wiki);
if (c.DEV_AUTH === "true" && wiki instanceof MemoryWiki) await seedDemo(world);
await world.prepareViewState();
const { app } = await buildApp(c, store, world);
await app.listen({ port: c.PORT, host: c.HOST });
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => void app.close());
