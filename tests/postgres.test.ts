import { describe, it, expect } from "vitest";
import { PostgresStore } from "../apps/server/src/store";
import { World } from "../apps/server/src/world";
import { MemoryWiki } from "../apps/server/src/wiki";
import { seedDemo } from "../apps/server/src/demo";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("PostgreSQL persistence", () => {
  it("commits once across services, rolls back failure, and survives pool restart", async () => {
    const first = new PostgresStore(url!),
      wiki = new MemoryWiki();
    await first.migrate();
    for (const table of Object.keys(
      (await import("../apps/server/src/store")).tables,
    ))
      await first.pool.query(`TRUNCATE wt_${table.toLowerCase()}`);
    const world = new World(first, wiki);
    await seedDemo(world);
    let state = await first.read();
    const session = Object.values(state.sessions)[0],
      c = Object.values(state.characters).find((c) => c.ownerId === "mara")!;
    await world.join("mara", session.id, c.id);
    const second = new PostgresStore(url!),
      other = new World(second, wiki);
    const command = {
      type: "move" as const,
      operationId: "db-move",
      sessionId: session.id,
      characterId: c.id,
      revision: 0,
      position: [2, -3, 0] as [number, number, number],
    };
    await Promise.all([
      world.command("mara", command),
      other.command("mara", command),
    ]);
    await expect(
      first.transaction((s) => {
        s.placements[c.id].position = [99, 0, 0];
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    let release!: () => void, signal!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      started = new Promise<void>((resolve) => {
        signal = resolve;
      });
    const areaId = Object.values((await first.read()).areas)[0].id;
    const authoring = first.transaction(async (s) => {
      s.areas[areaId].name = "Concurrent draft edit";
      signal();
      await gate;
    }, "authoring");
    await started;
    try {
      await other.command("mara", {
        ...command,
        operationId: "while-wiki-waits",
        revision: 1,
        position: [3, -4, 0],
      });
    } finally {
      release();
    }
    await authoring;
    await first.close();
    await second.close();
    const restarted = new PostgresStore(url!);
    try {
      state = await restarted.read();
      expect(state.placements[c.id].position).toEqual([3, -4, 0]);
      expect(state.placements[c.id].revision).toBe(2);
      expect(state.areas[areaId].name).toBe("Concurrent draft edit");
      expect(Object.values(state.operations)).toHaveLength(2);
      expect(Object.values(state.outbox).some((e) => e.type === "move")).toBe(
        true,
      );
    } finally {
      await restarted.close();
    }
  });
});
