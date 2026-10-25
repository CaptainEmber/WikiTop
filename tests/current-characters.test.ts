import { it, expect } from "vitest";
import { MemoryStore } from "../apps/server/src/store";
import { MemoryWiki } from "../apps/server/src/wiki";
import { World } from "../apps/server/src/world";
import { seedDemo } from "../apps/server/src/demo";
it("joins a group atomically and refuses foreign characters without partially placing the group", async () => {
  const store = new MemoryStore(),
    world = new World(store, new MemoryWiki());
  await seedDemo(world);
  const s = await store.read(),
    sessionId = Object.keys(s.sessions)[0],
    foreign = Object.values(s.characters).find((c) => c.ownerId === "rowan")!;
  const a = await world.createCharacter("mara", "One"),
    b = await world.createCharacter("mara", "Two");
  const before = await store.read();
  await expect(
    world.joinCharacters("mara", sessionId, [a.id, foreign.id]),
  ).rejects.toThrow(/own character/);
  expect((await store.read()).placements).toEqual(before.placements);
  const joined = await world.joinCharacters("mara", sessionId, [
    a.id,
    b.id,
    a.id,
  ]);
  expect(joined).toHaveLength(2);
  expect(joined.map((p) => p.characterId)).toEqual([a.id, b.id]);
  expect(await world.joinCharacters("mara", sessionId, [a.id, b.id])).toEqual(
    joined,
  );
});
