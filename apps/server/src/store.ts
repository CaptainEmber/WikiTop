import pg, { type Pool as PgPool } from "pg";
const { Pool } = pg;
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text, jsonb } from "drizzle-orm/pg-core";
import { eq, sql } from "drizzle-orm";
import { collections, emptyState, type WorldState } from "@wikitop/shared";

// Separate tables preserve subsystem boundaries; JSONB carries each versioned record.
export const tables = Object.fromEntries(
  collections.map((name) => [
    name,
    pgTable(`wt_${name.toLowerCase()}`, {
      id: text("id").primaryKey(),
      data: jsonb("data").notNull(),
    }),
  ]),
) as unknown as Record<
  (typeof collections)[number],
  ReturnType<typeof makeTable>
>;
function makeTable() {
  return pgTable("unused", {
    id: text("id").primaryKey(),
    data: jsonb("data").notNull(),
  });
}
export type WriteScope = "live" | "authoring";
export interface Store {
  read(): Promise<WorldState>;
  transaction<T>(
    fn: (state: WorldState) => Promise<T> | T,
    scope?: WriteScope,
  ): Promise<T>;
  close(): Promise<void>;
}
export class MemoryStore implements Store {
  private state: WorldState;
  private tails: Record<WriteScope, Promise<unknown>> = {
    live: Promise.resolve(),
    authoring: Promise.resolve(),
  };
  constructor(state = emptyState()) {
    this.state = { ...emptyState(), ...structuredClone(state) };
  }
  async read() {
    return structuredClone(this.state);
  }
  transaction<T>(
    fn: (state: WorldState) => Promise<T> | T,
    scope: WriteScope = "live",
  ): Promise<T> {
    const task = this.tails[scope].then(async () => {
      const before = structuredClone(this.state),
        next = structuredClone(before);
      const value = await fn(next);
      for (const collection of collections) {
        const old = before[collection] as Record<string, unknown>,
          current = next[collection] as Record<string, unknown>,
          target = this.state[collection] as Record<string, unknown>;
        for (const key of Object.keys(old))
          if (!(key in current)) delete target[key];
        for (const [key, data] of Object.entries(current))
          if (JSON.stringify(old[key]) !== JSON.stringify(data))
            target[key] = structuredClone(data);
      }
      return value;
    });
    this.tails[scope] = task.catch(() => {});
    return task;
  }
  async close() {}
}
export class PostgresStore implements Store {
  readonly pool: PgPool;
  readonly db: ReturnType<typeof drizzle>;
  constructor(url: string) {
    this.pool = new Pool({ connectionString: url, max: 8 });
    this.db = drizzle(this.pool);
  }
  async migrate() {
    for (const name of collections)
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS wt_${name.toLowerCase()} (id text PRIMARY KEY, data jsonb NOT NULL)`,
      );
  }
  private async load(db: any): Promise<WorldState> {
    const s = emptyState();
    for (const name of collections) {
      const rows = await db.select().from(tables[name]);
      (s as any)[name] = Object.fromEntries(
        rows.map((r: any) => [r.id, r.data]),
      );
    }
    return s;
  }
  async read() {
    return this.db.transaction(async (tx) => this.load(tx), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  }
  async transaction<T>(
    fn: (s: WorldState) => Promise<T> | T,
    scope: WriteScope = "live",
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      // Keep external wiki latency outside the live-command writer lock.
      const lock = scope === "authoring" ? 87120432 : 87120431;
      await tx.execute(sql`select pg_advisory_xact_lock(${lock})`);
      const before = await this.load(tx);
      const next = structuredClone(before);
      const result = await fn(next);
      for (const name of collections) {
        const old = before[name] as Record<string, unknown>,
          current = next[name] as Record<string, unknown>;
        const table = tables[name];
        for (const id of Object.keys(old))
          if (!(id in current)) await tx.delete(table).where(eq(table.id, id));
        for (const [id, data] of Object.entries(current))
          if (JSON.stringify(old[id]) !== JSON.stringify(data))
            await tx
              .insert(table)
              .values({ id, data })
              .onConflictDoUpdate({ target: table.id, set: { data } });
      }
      return result;
    });
  }
  async close() {
    await this.pool.end();
  }
}
