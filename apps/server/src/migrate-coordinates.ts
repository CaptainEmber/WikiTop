import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { config } from "./config.js";
import { PostgresStore } from "./store.js";
import { RemoteWiki } from "./wiki.js";
import { hash } from "./world.js";
import { migrateCoordinateState } from "./coordinate-migration.js";
import type { WorldState } from "@wikitop/shared";

function stateHash(value: unknown) {
  return hash(
    JSON.stringify(value, (_key, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, v[k]]),
          )
        : v,
    ),
  );
}
const c = config();
if (!c.DATABASE_URL)
  throw new Error("DATABASE_URL is required. Stop play before migrating.");
const store = new PostgresStore(c.DATABASE_URL),
  wiki = new RemoteWiki(c);
const path = resolve(
  process.env.COORDINATE_BACKUP_FILE ?? ".data/z-up-backup.json",
);
type Backup = { state: WorldState; drafts: Record<string, unknown> };
try {
  let backup: Backup;
  try {
    backup = JSON.parse(await readFile(path, "utf8"));
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
    const state = await store.read(),
      drafts: Record<string, unknown> = {};
    for (const area of Object.values(state.areas)) {
      const page = await wiki.read(area.scenePageId),
        raw = JSON.parse(
          page.content.replace(/^```json\s*/, "").replace(/\s*```$/, ""),
        );
      if (hash(raw) !== area.sceneHash)
        throw new Error(
          `Wiki source hash mismatch for ${area.name}; reconcile it before migrating.`,
        );
      drafts[area.id] = raw;
    }
    backup = { state, drafts };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(backup, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  }
  const migrated = migrateCoordinateState(backup.state, backup.drafts),
    current = await store.read();
  if (
    stateHash(current) !== stateHash(backup.state) &&
    stateHash(current) !== stateHash(migrated.state)
  )
    throw new Error(
      "Database changed after the backup. Stop play and reconcile before retrying.",
    );
  for (const area of Object.values(backup.state.areas)) {
    const page = await wiki.read(area.scenePageId),
      raw = JSON.parse(
        page.content.replace(/^```json\s*/, "").replace(/\s*```$/, ""),
      ),
      next = migrated.scenes[area.id];
    if (hash(raw) === hash(next)) continue;
    if (hash(raw) !== hash(backup.drafts[area.id]))
      throw new Error(
        `Wiki draft changed for ${area.name}; migration stopped.`,
      );
    await wiki.writeScene(area.scenePageId, next);
  }
  await store.transaction((s) => {
    if (
      stateHash(s) !== stateHash(backup.state) &&
      stateHash(s) !== stateHash(migrated.state)
    )
      throw new Error(
        "Database changed during migration. Retry using the same backup while play is stopped.",
      );
    Object.assign(s, migrated.state);
  });
  console.log(
    `Z-up migration complete. Keep the private recovery backup at ${path}.`,
  );
} finally {
  await store.close();
}
