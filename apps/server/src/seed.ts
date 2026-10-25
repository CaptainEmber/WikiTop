import { config } from "./config.js";
import { PostgresStore } from "./store.js";
import { RemoteWiki } from "./wiki.js";
import { World } from "./world.js";
import { seedDemo } from "./demo.js";
const c = config();
if (!c.DATABASE_URL) throw new Error("DATABASE_URL required");
const store = new PostgresStore(c.DATABASE_URL);
try {
  const s = await store.read(),
    emails = (process.env.SEED_EMAILS ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase());
  const accounts = emails.map((email) =>
    Object.values(s.accounts).find((a) => a.email === email),
  );
  if (accounts.length < 2 || accounts.some((a) => !a))
    throw new Error(
      "Set SEED_EMAILS to at least two existing accounts; sign into play and wiki first",
    );
  await seedDemo(
    new World(store, new RemoteWiki(c)),
    accounts as NonNullable<(typeof accounts)[number]>[],
  );
  console.log("Seeded the tavern and basement");
} finally {
  await store.close();
}
