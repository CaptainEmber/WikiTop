import { beforeEach, expect, it } from "vitest";
import {
  emptyScene,
  flattenThings,
  type Command,
  type Thing,
} from "../packages/shared/src/index";
import { MemoryStore } from "../apps/server/src/store";
import { MemoryWiki } from "../apps/server/src/wiki";
import { World } from "../apps/server/src/world";
import { seedDemo } from "../apps/server/src/demo";
import { randomUUID } from "node:crypto";
let store: MemoryStore,
  world: World,
  sessionId: string,
  mara: string,
  rowan: string,
  tavern: string;
beforeEach(async () => {
  store = new MemoryStore();
  world = new World(store, new MemoryWiki());
  await seedDemo(world);
  const s = await store.read();
  sessionId = Object.values(s.sessions)[0].id;
  mara = Object.values(s.characters).find((c) => c.ownerId === "mara")!.id;
  rowan = Object.values(s.characters).find((c) => c.ownerId === "rowan")!.id;
  tavern = Object.values(s.areas).find((a) => a.ownerId === "mara")!.id;
  await world.join("mara", sessionId, mara);
  await world.join("rowan", sessionId, rowan);
});
const snapshot = async (actor = "mara", characterId = mara) =>
  world.snapshot(await store.read(), actor, sessionId, characterId);
async function act(
  actor: string,
  characterId: string,
  action: Extract<Command, { type: "interact" }>["action"],
  targetId: string,
  extra: Partial<Extract<Command, { type: "interact" }>> = {},
) {
  const snap = await snapshot(actor, characterId);
  return world.command(actor, {
    type: "interact",
    operationId: randomUUID(),
    sessionId,
    characterId,
    revision: snap.session.liveRevision ?? 0,
    action,
    targetId,
    ...extra,
  });
}
it("separates live control from authored editing and supports delegation/revocation", async () => {
  await expect(
    act("rowan", rowan, "move", "flask", { position: [1, 1, 0] }),
  ).rejects.toMatchObject({ code: "forbidden" });
  await act("mara", mara, "control", "flask", { recipientId: "rowan" });
  expect((await snapshot("rowan", rowan)).controllableIds).toContain("flask");
  await act("rowan", rowan, "move", "flask", { position: [1, 1, 0] });
  expect(
    (await snapshot()).scene.things.find((t) => t.id === "flask")!.position,
  ).toEqual([1, 1, 0]);
  await expect(world.draft("rowan", tavern)).rejects.toMatchObject({
    code: "forbidden",
  });
  await act("mara", mara, "control", "flask", { recipientId: "mara" });
  await expect(
    act("rowan", rowan, "move", "flask", { position: [2, 1, 0] }),
  ).rejects.toMatchObject({ code: "forbidden" });
});
it("requires a character owner to grant control before another player moves it", async () => {
  await expect(
    act("mara", mara, "move", rowan, { position: [2, 2, 0] }),
  ).rejects.toMatchObject({ code: "forbidden" });
  await act("rowan", rowan, "control", rowan, { recipientId: "mara" });
  await act("mara", mara, "move", rowan, { position: [2, 2, 0] });
  expect((await snapshot("rowan", rowan)).placement.position).toEqual([
    2, 2, 0,
  ]);
  await expect(
    world.updateCharacter("mara", rowan, { description: "Hijack" }),
  ).rejects.toMatchObject({ code: "forbidden" });
});
it("takes and drops atomically without changing published or other-session copies", async () => {
  const before = await snapshot();
  const publishedBefore = structuredClone(
    (await store.read()).publications[before.publication.id].scene,
  );
  const command: Command = {
    type: "interact",
    operationId: randomUUID(),
    sessionId,
    characterId: mara,
    revision: before.session.liveRevision ?? 0,
    action: "take",
    targetId: "flask",
  };
  await world.command("mara", command);
  await world.command("mara", command);
  let snap = await snapshot();
  expect(snap.inventory.filter((t) => t.name === "Flask")).toHaveLength(1);
  expect(snap.scene.things.some((t) => t.id === "flask")).toBe(false);
  expect(snap.publication.scene.things.some((t) => t.id === "flask")).toBe(
    false,
  );
  expect(
    (await store.read()).publications[before.publication.id].scene,
  ).toEqual(publishedBefore);
  expect(
    (await snapshot("rowan", rowan)).scene.things.some((t) => t.id === "flask"),
  ).toBe(false);
  const carried = snap.inventory.find((t) => t.name === "Flask")!;
  await act("mara", mara, "drop", carried.id);
  snap = await snapshot();
  expect(snap.inventory.some((t) => t.id === carried.id)).toBe(false);
  expect(snap.scene.things.find((t) => t.id === carried.id)?.position).toEqual(
    snap.placement.position,
  );
  await act("mara", mara, "take", carried.id);
  expect((await snapshot()).inventory.find((t) => t.name === "Flask")!.id).toBe(
    carried.id,
  );
  const other = await world.createSession("rowan", "Separate story", [tavern]);
  await world.leave("rowan", sessionId, rowan);
  await world.join("rowan", other.id, rowan);
  expect(
    world
      .snapshot(await store.read(), "rowan", other.id, rowan)
      .scene.things.some((t) => t.id === "flask"),
  ).toBe(true);
});
it("rejects stale concurrent takes and out-of-bounds movement", async () => {
  const stale = (await snapshot()).session.liveRevision ?? 0;
  await act("mara", mara, "take", "flask");
  await expect(
    act("rowan", rowan, "take", "flask", { revision: stale }),
  ).rejects.toMatchObject({ code: "stale_scene" });
  await expect(
    act("mara", mara, "move", mara, { position: [1000, 0, 0] }),
  ).rejects.toMatchObject({ code: "out_of_bounds" });
  await expect(act("mara", mara, "take", "floor")).rejects.toMatchObject({
    code: "forbidden",
  });
});
it("does not disclose private contents through publication, session, occupant or library records", async () => {
  const secret: Thing = {
    id: "secret",
    name: "Hidden password",
    description: "secret description",
    role: "inventory",
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    children: [],
    portable: true,
  };
  await store.transaction((s) => {
    s.sessions[sessionId].liveThings![tavern].push({
      ...secret,
      id: "bag",
      name: "Private bag",
      contentsVisibility: "controllers",
      children: [secret],
    });
    s.sessions[sessionId].inventories![mara].push({
      ...secret,
      id: "mara_secret",
    });
  });
  const other = await snapshot("rowan", rowan);
  expect(JSON.stringify(other)).not.toContain("Hidden password");
  expect(other.peerableIds).not.toContain("bag");
  expect(other.peerableIds).toContain(mara);
  expect(other.inventories[mara]).toEqual([]);
  expect(JSON.stringify(await world.library("rowan"))).not.toContain(
    "Hidden password",
  );
  await expect(act("rowan", rowan, "take", "secret")).rejects.toMatchObject({
    code: "not_found",
  });
  expect(
    flattenThings((await snapshot()).scene.things).some(
      (t) => t.id === "secret",
    ),
  ).toBe(true);
});
it("restores session inventories and live positions from durable state", async () => {
  await act("mara", mara, "take", "flask");
  await act("mara", mara, "move", mara, { position: [2, 2, 0] });
  const restored = new World(
    new MemoryStore(await store.read()),
    new MemoryWiki(),
  );
  const snap = restored.snapshot(
    await restored.store.read(),
    "mara",
    sessionId,
    mara,
  );
  expect(snap.inventory.some((t) => t.name === "Flask")).toBe(true);
  expect(snap.placement.position).toEqual([2, 2, 0]);
});
it("opens a map pin into its published interior and returns to the parent location", async () => {
  await world.leave("mara", sessionId, mara);
  const city = await world.createArea("mara", "City");
  await world.saveScene("mara", city.id, 0, {
    ...emptyScene(),
    things: [
      {
        id: "tavern-pin",
        name: "Emberheart",
        description: "A tavern",
        role: "spatial",
        position: [2, 2, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
        children: [],
        interiorAreaId: tavern,
      },
    ],
  });
  await world.publish("mara", city.id);
  const session = await world.createSession("mara", "Explore city", [city.id]);
  sessionId = session.id;
  await world.join("mara", sessionId, mara);
  const before = await snapshot();
  expect(session.allowedAreaIds).toContain(tavern);
  await act("mara", mara, "enter", "tavern-pin");
  expect((await snapshot()).placement.areaId).toBe(tavern);
  await act("mara", mara, "exit", mara);
  expect((await snapshot()).placement.areaId).toBe(city.id);
  expect((await snapshot()).placement.position).toEqual(
    before.placement.position,
  );
});
it("copies character inventory templates once per session", async () => {
  const before = (await snapshot()).inventory;
  await world.updateCharacter("mara", mara, { children: [] });
  expect((await snapshot()).inventory).toEqual(before);
  await world.leave("mara", sessionId, mara);
  await world.join("mara", sessionId, mara);
  expect((await snapshot()).inventory).toEqual(before);
});

it("drops a portable item out of a nested bag but keeps stats in the inventory", async () => {
  const item: Thing = {
    id: "sword",
    name: "Sword",
    description: "A nested item",
    role: "inventory",
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    portable: true,
    children: [],
  };
  await store.transaction((s) => {
    s.sessions[sessionId].inventories![mara].push({
      ...item,
      id: "bag",
      name: "Bag",
      children: [item],
    });
  });
  await act("mara", mara, "drop", "sword");
  const snap = await snapshot();
  expect(snap.inventory.find((t) => t.id === "bag")!.children).toEqual([]);
  expect(snap.scene.things.find((t) => t.id === "sword")?.role).toBe("spatial");
  await expect(
    act(
      "mara",
      mara,
      "drop",
      (await snapshot()).inventory.find((t) => t.name === "Notes")!.id,
    ),
  ).rejects.toMatchObject({
    code: "forbidden",
  });
});

it("rejects returning to a parent whose play access was withdrawn without losing placement", async () => {
  await world.leave("mara", sessionId, mara);
  const city = await world.createArea("rowan", "Shared city");
  await world.saveScene("rowan", city.id, 0, {
    ...emptyScene(),
    things: [
      {
        id: "tavern-pin",
        name: "Tavern",
        description: "",
        role: "spatial",
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
        children: [],
        interiorAreaId: tavern,
      },
    ],
  });
  await world.publish("rowan", city.id);
  await world.share("rowan", city.id, "mara");
  const session = await world.createSession("mara", "Visit city", [city.id]);
  sessionId = session.id;
  await world.join("mara", sessionId, mara);
  await act("mara", mara, "enter", "tavern-pin");
  const before = (await snapshot()).placement;
  await store.transaction((s) => {
    s.areas[city.id].sharedWith = [];
  });
  await expect(act("mara", mara, "exit", mara)).rejects.toMatchObject({
    code: "forbidden",
  });
  expect((await snapshot()).placement).toEqual(before);
});
