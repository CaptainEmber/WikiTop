import { beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  type Thing,
  type ViewTarget,
  type Command,
} from "../packages/shared/src/index";
import { MemoryStore } from "../apps/server/src/store";
import { MemoryWiki } from "../apps/server/src/wiki";
import { World } from "../apps/server/src/world";
import { seedDemo } from "../apps/server/src/demo";
import { resolveView } from "../apps/server/src/views";
let store: MemoryStore,
  world: World,
  sessionId: string,
  mara: string,
  rowan: string;
const item = (id: string, flags: Partial<Thing> = {}): Thing => ({
  id: id.replaceAll(" ", "_"),
  name: id,
  description: `${id} description`,
  role: "inventory",
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
  children: [],
  portable: true,
  ...flags,
});
beforeEach(async () => {
  store = new MemoryStore();
  world = new World(store, new MemoryWiki());
  await seedDemo(world);
  const state = await store.read();
  sessionId = Object.values(state.sessions)[0].id;
  mara = Object.values(state.characters).find((c) => c.ownerId === "mara")!.id;
  rowan = Object.values(state.characters).find(
    (c) => c.ownerId === "rowan",
  )!.id;
  await world.updateCharacter("mara", mara, {
    children: [
      item("backpack", {
        visible: true,
        peerable: false,
        children: [item("secret sword", { visible: true })],
      }),
      item("held torch", { visible: true }),
      item("private notes", { role: "attribute", value: "Secret notes" }),
    ],
  });
  await world.join("mara", sessionId, mara);
  await world.join("rowan", sessionId, rowan);
});
const interior = (rootId = mara, path: string[] = []): ViewTarget => ({
  kind: "interior",
  root: "character",
  rootId,
  path,
});
async function snap(actor = "mara", target: ViewTarget = { kind: "location" }) {
  return world.snapshot(
    await store.read(),
    actor,
    sessionId,
    actor === "mara" ? mara : rowan,
    target,
  );
}
async function act(
  actor: string,
  viewTarget: ViewTarget,
  action: Extract<Command, { type: "interact" }>["action"],
  targetId: string,
  extra: Partial<Extract<Command, { type: "interact" }>> = {},
) {
  const current = await snap(actor);
  return world.command(actor, {
    type: "interact",
    sessionId,
    characterId: actor === "mara" ? mara : rowan,
    operationId: randomUUID(),
    revision: current.session.liveRevision ?? 0,
    viewTarget,
    action,
    targetId,
    ...extra,
  });
}
it("opens own and nested interiors without moving, and resolves location from the latest placement", async () => {
  const before = await snap();
  const own = await snap("mara", interior());
  expect(own.placement).toEqual(before.placement);
  expect(own.view.name).toBe("Mara");
  expect(own.view.scene.things).toHaveLength(3);
  const bag = own.view.scene.things.find((t) => t.name === "backpack")!;
  const nested = await snap("mara", interior(mara, [bag.id]));
  expect(nested.view.scene.things[0].name).toBe("secret sword");
  expect(nested.placement).toEqual(before.placement);
  await act("mara", { kind: "location" }, "move", mara, {
    position: [3, 4, 0],
  });
  expect((await snap("mara", interior())).view.target).toEqual(interior());
  expect((await snap()).placement.position).toEqual([3, 4, 0]);
});
it("visible and peerable are independent, and hidden descendants cannot be requested by ID", async () => {
  const owner = await snap("mara", interior()),
    bag = owner.view.scene.things.find((t) => t.name === "backpack")!,
    hidden = owner.view.scene.things.find((t) => t.name === "private notes")!;
  const peer = await snap("rowan", interior());
  expect(peer.view.scene.things.map((t) => t.name)).toEqual([
    "backpack",
    "held torch",
  ]);
  expect(peer.view.scene.things[0].children).toEqual([]);
  expect(peer.view.peerableIds).not.toContain(bag.id);
  expect(JSON.stringify(peer)).not.toContain("secret sword");
  expect(JSON.stringify(peer)).not.toContain("Secret notes");
  for (const path of [[bag.id], [hidden.id], [bag.id, bag.children[0].id]])
    expect((await snap("rowan", interior(mara, path))).view.target.kind).toBe(
      "location",
    );
  const state = await store.read();
  expect(() =>
    resolveView(
      state,
      state.sessions[sessionId],
      "rowan",
      state.placements[rowan],
      interior(mara, [bag.id]),
    ),
  ).toThrow();
});
it("delegated control allows arranging visible items but cannot reveal private contents", async () => {
  const own = await snap("mara", interior());
  const torch = own.view.scene.things.find((t) => t.name === "held torch")!,
    notes = own.view.scene.things.find((t) => t.name === "private notes")!;
  await expect(
    act("rowan", interior(), "move", torch.id, { position: [2, 2, 0] }),
  ).rejects.toMatchObject({ code: "forbidden" });
  await act("mara", { kind: "location" }, "control", mara, {
    recipientId: "rowan",
  });
  const before = (await snap()).placement;
  expect((await snap("rowan")).session.controllers).toBeUndefined();
  await act("rowan", interior(), "move", torch.id, { position: [2, 2, 0] });
  expect(
    (await snap("mara", interior())).view.scene.things.find(
      (t) => t.id === torch.id,
    )!.position,
  ).toEqual([2, 2, 0]);
  expect((await snap()).placement).toEqual(before);
  await expect(
    act("rowan", interior(), "move", notes.id, { position: [1, 1, 0] }),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    act("rowan", interior(), "flags", torch.id, { visible: false }),
  ).rejects.toMatchObject({ code: "forbidden" });
  await act("mara", { kind: "location" }, "control", mara, {
    recipientId: "mara",
  });
  await expect(
    act("rowan", interior(), "move", torch.id, { position: [1, 1, 0] }),
  ).rejects.toMatchObject({ code: "forbidden" });
});
it("opening and revoking a backpack updates server projections immediately", async () => {
  const bag = (await snap("mara", interior())).view.scene.things.find(
    (t) => t.name === "backpack",
  )!;
  await act("mara", interior(), "flags", bag.id, { peerable: true });
  expect(
    (await snap("rowan", interior(mara, [bag.id]))).view.scene.things[0].name,
  ).toBe("secret sword");
  await act("mara", interior(), "flags", bag.id, { peerable: false });
  expect((await snap("rowan", interior(mara, [bag.id]))).view.target.kind).toBe(
    "location",
  );
  await act("mara", interior(), "flags", bag.id, {
    visible: false,
    peerable: true,
  });
  expect(
    (await snap("rowan", interior())).view.scene.things.some(
      (t) => t.id === bag.id,
    ),
  ).toBe(false);
  expect((await snap("mara", interior(mara, [bag.id]))).view.target.kind).toBe(
    "interior",
  );
});
it("invalidates another character view on departure while the owner keeps viewing themselves", async () => {
  const before = await snap();
  await world.command("mara", {
    type: "travel",
    sessionId,
    characterId: mara,
    operationId: randomUUID(),
    revision: before.placement.revision,
    connectionId: before.exits[0].connectionId,
  });
  expect((await snap("rowan", interior())).view.target.kind).toBe("location");
  expect((await snap("mara", interior())).view.target).toEqual(interior());
  expect((await snap()).publication.name).toBe("The Stone Basement");
});
it("interior movement is scoped, bounded, durable and cannot take another character items", async () => {
  const torch = (await snap("mara", interior())).view.scene.things.find(
    (t) => t.name === "held torch",
  )!;
  await expect(
    act("mara", { kind: "location" }, "move", torch.id, {
      position: [1, 1, 0],
    }),
  ).rejects.toMatchObject({ code: "invalid_target" });
  await expect(
    act("mara", interior(), "move", torch.id, { position: [1000, 0, 0] }),
  ).rejects.toMatchObject({ code: "out_of_bounds" });
  await expect(
    act("rowan", interior(), "take", torch.id),
  ).rejects.toMatchObject({ code: "not_found" });
  await act("mara", interior(), "move", torch.id, { position: [1, 1, 0] });
  const restored = new World(
    new MemoryStore(await store.read()),
    new MemoryWiki(),
  );
  expect(
    restored
      .snapshot(
        await restored.store.read(),
        "mara",
        sessionId,
        mara,
        interior(),
      )
      .view.scene.things.find((t) => t.id === torch.id)!.position,
  ).toEqual([1, 1, 0]);
});
it("arranges overlapping legacy inventory once, keeps it private, and preserves publication hashes", async () => {
  const state = await store.read(),
    session = state.sessions[sessionId];
  expect(
    new Set(session.inventories![mara].map((t) => t.position.join(","))).size,
  ).toBe(3);
  const pubs = JSON.stringify(state.publications),
    positions = structuredClone(session.inventories![mara]);
  await world.prepareViewState();
  expect((await store.read()).sessions[sessionId].inventories![mara]).toEqual(
    positions,
  );
  expect(JSON.stringify((await store.read()).publications)).toBe(pubs);
  expect(
    (await snap("rowan", interior())).view.scene.things.some(
      (t) => t.name === "private notes",
    ),
  ).toBe(false);
});
it("speech remains in the physical room while looking inside a character", async () => {
  const before = await snap();
  await snap("mara", interior());
  await world.command("mara", {
    type: "chat",
    sessionId,
    characterId: mara,
    operationId: randomUUID(),
    channel: "speech",
    text: "Still in the tavern",
  });
  const state = await store.read();
  expect(Object.values(state.messages)[0].areaId).toBe(before.placement.areaId);
  expect((await snap()).placement).toEqual(before.placement);
});

it("character control does not bypass character peering or visibility flags", async () => {
  await act("mara", { kind: "location" }, "control", mara, {
    recipientId: "rowan",
  });
  await act("mara", { kind: "location" }, "flags", mara, { peerable: false });
  expect((await snap("rowan", interior())).view.target.kind).toBe("location");
  expect((await snap("rowan")).inventories[mara]).toBeUndefined();
  await act("rowan", { kind: "location" }, "move", mara, {
    position: [2, 2, 0],
  });
  await act("mara", { kind: "location" }, "flags", mara, { visible: false });
  expect(
    (await snap("rowan")).occupants.some((o) => o.character.id === mara),
  ).toBe(false);
  await expect(
    act("rowan", { kind: "location" }, "move", mara, { position: [3, 3, 0] }),
  ).rejects.toMatchObject({ code: "not_found" });
  expect((await snap("mara", interior())).view.target).toEqual(interior());
});
it("migrates existing inventory flags without changing legacy IDs or publications", async () => {
  await store.transaction((s) => {
    const session = s.sessions[sessionId];
    session.viewFormat = undefined;
    session.characterFlags = undefined;
    session.characterSpaces = undefined;
    session.inventories![mara] = [
      item("legacy-bag", { children: [item("legacy-sword")] }),
    ];
  });
  const before = await store.read();
  await world.prepareViewState();
  const after = await store.read();
  expect(after.publications).toEqual(before.publications);
  expect(after.placements).toEqual(before.placements);
  const bag = after.sessions[sessionId].inventories![mara][0];
  expect(bag.id).toBe("legacy-bag");
  expect(bag.children[0].id).toBe("legacy-sword");
  expect(bag.visible).toBe(false);
  expect(bag.peerable).toBe(false);
  await world.prepareViewState();
  expect((await store.read()).sessions[sessionId]).toEqual(
    after.sessions[sessionId],
  );
});
