import { beforeEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  DrawingSchema,
  drawingSvg,
  CommandSchema,
  type ViewTarget,
  type DrawingStroke,
} from "../packages/shared/src/index";
import { MemoryStore } from "../apps/server/src/store";
import { MemoryWiki } from "../apps/server/src/wiki";
import { World } from "../apps/server/src/world";
import { seedDemo } from "../apps/server/src/demo";
let store: MemoryStore,
  wiki: MemoryWiki,
  world: World,
  sessionId: string,
  mara: string,
  rowan: string,
  areaId: string;
const room: ViewTarget = { kind: "location" };
const inside = (rootId: string, path: string[] = []): ViewTarget => ({
  kind: "interior",
  root: "character",
  rootId,
  path,
});
const stroke = (id = randomUUID()): DrawingStroke => ({
  id,
  authorId: "forged",
  color: "#ffcc00",
  width: 0.08,
  points: [
    [0, 0],
    [1, 1],
  ],
});
beforeEach(async () => {
  store = new MemoryStore();
  wiki = new MemoryWiki();
  world = new World(store, wiki);
  await seedDemo(world);
  const s = await store.read();
  sessionId = Object.keys(s.sessions)[0];
  mara = Object.values(s.characters).find((c) => c.ownerId === "mara")!.id;
  rowan = Object.values(s.characters).find((c) => c.ownerId === "rowan")!.id;
  await world.join("mara", sessionId, mara);
  await world.join("rowan", sessionId, rowan);
  areaId = (await store.read()).placements[mara].areaId;
});
async function snap(actor = "mara", viewTarget = room) {
  return world.snapshot(
    await store.read(),
    actor,
    sessionId,
    actor === "mara" ? mara : rowan,
    viewTarget,
  );
}
async function command(
  actor: string,
  action: string,
  extra: any = {},
  target = room,
) {
  const b = (await snap(actor, target)).view.drawing!;
  return world.command(
    actor,
    CommandSchema.parse({
      type: "drawing",
      operationId: randomUUID(),
      sessionId,
      characterId: actor === "mara" ? mara : rowan,
      boardId: b.id,
      viewTarget: target,
      revision: b.revision,
      action,
      ...extra,
    }),
  );
}
it("separates boards, defaults disabled, and never changes physical placements", async () => {
  const before = (await store.read()).placements;
  expect((await snap("rowan")).view.drawing!.enabled).toBe(false);
  await expect(
    command("rowan", "stroke", { stroke: stroke() }),
  ).rejects.toThrow(/enabled/);
  await command("mara", "enable", { enabled: true });
  await command("rowan", "stroke", { stroke: stroke() });
  const a = (await snap()).view.drawing!,
    b = (await snap("rowan")).view.drawing!;
  expect(a.drawing).toEqual(b.drawing);
  expect(a.drawing.strokes[0].authorId).toBe("rowan");
  expect(
    (await snap("mara", inside(mara))).view.drawing!.drawing.strokes,
  ).toHaveLength(0);
  expect((await store.read()).placements).toEqual(before);
  expect((await snap()).session.drawings).toBeUndefined();
});
it("merges concurrent strokes, deduplicates retries, and rejects operation reuse", async () => {
  await command("mara", "enable", { enabled: true });
  const b = (await snap()).view.drawing!;
  const payload = CommandSchema.parse({
    type: "drawing",
    operationId: randomUUID(),
    sessionId,
    characterId: rowan,
    boardId: b.id,
    viewTarget: room,
    revision: b.revision,
    action: "stroke",
    stroke: stroke(),
  });
  await command("mara", "stroke", { stroke: stroke() });
  await world.command("rowan", payload);
  await world.command("rowan", payload);
  expect((await snap()).view.drawing!.drawing.strokes).toHaveLength(2);
  await expect(
    world.command("rowan", { ...payload, action: "clear" }),
  ).rejects.toThrow(/reused/);
});
it("restricts erasing and clearing, and undoes personal edits independently", async () => {
  await command("mara", "enable", { enabled: true });
  const a = stroke(),
    b = stroke();
  await command("mara", "stroke", { stroke: a });
  await command("rowan", "stroke", { stroke: b });
  await expect(command("rowan", "erase", { strokeId: a.id })).rejects.toThrow(
    /own/,
  );
  await expect(command("rowan", "clear")).rejects.toThrow(/owner/);
  await command("mara", "undo");
  expect((await snap()).view.drawing!.drawing.strokes.map((s) => s.id)).toEqual(
    [b.id],
  );
  await command("mara", "redo");
  await command("mara", "clear");
  expect((await snap()).view.drawing!.drawing.strokes).toHaveLength(0);
  await command("mara", "undo");
  expect((await snap()).view.drawing!.drawing.strokes).toHaveLength(2);
});
it("saves only the drawing to the draft, with publication and live isolation", async () => {
  await command("mara", "stroke", { stroke: stroke() });
  const before = await store.read(),
    b = (await snap()).view.drawing!,
    draft = await world.thingDocument("mara", areaId);
  const save = {
    sessionId,
    characterId: mara,
    viewTarget: room,
    boardId: b.id,
    boardRevision: b.revision,
    draftRevision: draft.revision,
    operationId: randomUUID(),
  };
  await world.saveDrawing("mara", save);
  await world.saveDrawing("mara", save);
  const after = await store.read(),
    next = await world.thingDocument("mara", areaId);
  expect(next.document.nodes[areaId].space!.drawing).toEqual(b.drawing);
  draft.document.nodes[areaId].space!.drawing = b.drawing;
  expect(next.document).toEqual(draft.document);
  expect(after.publications).toEqual(before.publications);
  expect(after.placements).toEqual(before.placements);
  expect((await snap()).view.drawing!.dirty).toBe(false);
  const pub = await world.publish("mara", areaId);
  expect(pub.scene.drawing).toEqual(b.drawing);
  expect(after.sessions[sessionId].pins).toEqual(
    before.sessions[sessionId].pins,
  );
});
it("rejects stale draft and board saves without losing drawings", async () => {
  await command("mara", "stroke", { stroke: stroke() });
  const b = (await snap()).view.drawing!,
    draft = await world.thingDocument("mara", areaId);
  const input = {
    sessionId,
    characterId: mara,
    viewTarget: room,
    boardId: b.id,
    boardRevision: b.revision,
    draftRevision: draft.revision,
    operationId: randomUUID(),
  };
  await command("mara", "stroke", { stroke: stroke() });
  await expect(world.saveDrawing("mara", input)).rejects.toThrow(/changed/);
  draft.document.nodes[areaId].description += " edited";
  await world.saveThingDocument(
    "mara",
    areaId,
    draft.revision,
    randomUUID(),
    draft.document,
  );
  await expect(
    world.saveDrawing("mara", { ...input, boardRevision: b.revision + 1 }),
  ).rejects.toThrow(/changed/);
  expect((await snap()).view.drawing!.drawing.strokes).toHaveLength(2);
});
it("denies hidden descendants, revoked peer access, and nonowner saves", async () => {
  const target = inside(mara);
  await command("mara", "enable", { enabled: true }, target);
  await command("rowan", "stroke", { stroke: stroke() }, target);
  const b = (await snap("rowan", target)).view.drawing!;
  expect(b.owner).toBe(false);
  expect(b.source).toBeUndefined();
  await expect(
    world.saveDrawing("rowan", {
      sessionId,
      characterId: rowan,
      viewTarget: target,
      boardId: b.id,
      boardRevision: b.revision,
      draftRevision: "x",
      operationId: randomUUID(),
    }),
  ).rejects.toThrow(/owner/);
  await store.transaction((s) => {
    s.sessions[sessionId].characterFlags![mara].peerable = false;
  });
  await expect(
    command("rowan", "stroke", { stroke: stroke() }, target),
  ).rejects.toThrow();
  expect((await snap("rowan", target)).view.target).toEqual(room);
});
it("restores completed drawings after restart and can keep drawing through wiki outages", async () => {
  await command("mara", "stroke", { stroke: stroke() });
  const expected = (await snap()).view.drawing!;
  store = new MemoryStore(await store.read());
  world = new World(store, wiki);
  await world.prepareViewState();
  expect((await snap()).view.drawing).toEqual(expected);
  wiki.read = async () => {
    throw new Error("wiki unavailable");
  };
  await command("mara", "stroke", { stroke: stroke() });
  const b = (await snap()).view.drawing!;
  await expect(
    world.saveDrawing("mara", {
      sessionId,
      characterId: mara,
      viewTarget: room,
      boardId: b.id,
      boardRevision: b.revision,
      draftRevision: "x",
      operationId: randomUUID(),
    }),
  ).rejects.toThrow(/unavailable/);
  expect(b.drawing.strokes).toHaveLength(2);
});
it("validates stroke sizes, SVG values, duplicate IDs, and bounds", async () => {
  const s = stroke();
  expect(DrawingSchema.safeParse({ version: 1, strokes: [s, s] }).success).toBe(
    false,
  );
  expect(
    DrawingSchema.safeParse({
      version: 1,
      strokes: [{ ...s, color: "url(evil)" }],
    }).success,
  ).toBe(false);
  expect(
    DrawingSchema.safeParse({
      version: 1,
      strokes: [{ ...s, points: Array(513).fill([0, 0]) }],
    }).success,
  ).toBe(false);
  expect(drawingSvg({ version: 1, strokes: [s] }, 20, 16)).toContain(
    "M0,0 L1,-1",
  );
  await expect(
    command("mara", "stroke", { stroke: { ...s, points: [[10001, 99]] } }),
  ).rejects.toThrow();
});
it("keeps new live strokes accepted while a slow wiki save is in progress", async () => {
  await command("mara", "stroke", { stroke: stroke() });
  const b = (await snap()).view.drawing!,
    draft = await world.thingDocument("mara", areaId);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    ready = new Promise<void>((r) => (started = r)),
    write = wiki.writeScene.bind(wiki);
  wiki.writeScene = async (...args) => {
    started();
    await gate;
    return write(...args);
  };
  const save = world.saveDrawing("mara", {
    sessionId,
    characterId: mara,
    viewTarget: room,
    boardId: b.id,
    boardRevision: b.revision,
    draftRevision: draft.revision,
    operationId: randomUUID(),
  });
  await ready;
  await command("mara", "stroke", { stroke: stroke() });
  release();
  await save;
  const after = (await snap()).view.drawing!;
  expect(after.drawing.strokes).toHaveLength(2);
  expect(after.dirty).toBe(true);
  expect(
    (await world.thingDocument("mara", areaId)).document.nodes[areaId].space!
      .drawing!.strokes,
  ).toHaveLength(1);
});
it("saves a nested character board through its template identity, not its live instance ID", async () => {
  const id = randomUUID(),
    instance = randomUUID();
  const thing = {
    id,
    name: "Sketchbook",
    description: "",
    role: "inventory" as const,
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0, 1] as [number, number, number, number],
    scale: [1, 1, 1] as [number, number, number],
    space: { width: 8, depth: 6 },
    children: [],
  };
  await store.transaction((s) => {
    s.characters[mara].children = [thing];
    s.sessions[sessionId].inventories![mara] = [
      { ...thing, id: instance, templateId: id, ownerId: "mara" },
    ];
  });
  const target = inside(mara, [instance]);
  await command("mara", "stroke", { stroke: stroke() }, target);
  const b = (await snap("mara", target)).view.drawing!,
    draft = await world.thingDocument("mara", mara);
  expect(b.source!.nodeId).not.toBe(instance);
  await world.saveDrawing("mara", {
    sessionId,
    characterId: mara,
    viewTarget: target,
    boardId: b.id,
    boardRevision: b.revision,
    draftRevision: draft.revision,
    operationId: randomUUID(),
  });
  const after = await world.thingDocument("mara", mara);
  expect(after.document.nodes[b.source!.nodeId].space!.drawing).toEqual(
    b.drawing,
  );
  expect((await snap()).placement.areaId).toBe(areaId);
});
it("rejects replacing an independently edited authored drawing", async () => {
  await command("mara", "stroke", { stroke: stroke() });
  const draft = await world.thingDocument("mara", areaId);
  draft.document.nodes[areaId].space!.drawing = {
    version: 1,
    strokes: [stroke()],
  };
  const changed = await world.saveThingDocument(
      "mara",
      areaId,
      draft.revision,
      randomUUID(),
      draft.document,
    ),
    b = (await snap()).view.drawing!;
  await expect(
    world.saveDrawing("mara", {
      sessionId,
      characterId: mara,
      viewTarget: room,
      boardId: b.id,
      boardRevision: b.revision,
      draftRevision: changed.revision,
      operationId: randomUUID(),
    }),
  ).rejects.toThrow(/authored drawing changed/);
  expect((await snap()).view.drawing!.dirty).toBe(true);
});
it("never saves a transferred container over an unrelated same-ID character template", async () => {
  const id = "shared-legacy-id",
    instance = randomUUID();
  const item = {
    id,
    name: "Container",
    description: "",
    role: "inventory" as const,
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0, 1] as [number, number, number, number],
    scale: [1, 1, 1] as [number, number, number],
    children: [],
    space: { width: 8, depth: 6 },
  };
  await store.transaction((s) => {
    s.characters[mara].children = [item];
    s.sessions[sessionId].inventories![mara] = [
      {
        ...item,
        id: instance,
        templateId: id,
        templateRootId: areaId,
        ownerId: "mara",
      },
    ];
  });
  const target = inside(mara, [instance]);
  await command("mara", "stroke", { stroke: stroke() }, target);
  const b = (await snap("mara", target)).view.drawing!;
  expect(b.source).toBeUndefined();
  expect(b.drawing.strokes).toHaveLength(1);
});

it("saves far-off ink without a background while keeping map dimensions and placements unchanged", async () => {
  const before = await snap(),
    draft = await world.thingDocument("mara", areaId);
  delete draft.document.nodes[areaId].media.background;
  const saved = await world.saveThingDocument(
    "mara",
    areaId,
    draft.revision,
    randomUUID(),
    draft.document,
  );
  const far = {
    ...stroke(),
    points: [
      [9000, -8000],
      [9001, -7999],
    ] as [number, number][],
  };
  await command("mara", "stroke", { stroke: far });
  const b = (await snap()).view.drawing!;
  await world.saveDrawing("mara", {
    sessionId,
    characterId: mara,
    viewTarget: room,
    boardId: b.id,
    boardRevision: b.revision,
    draftRevision: saved.revision,
    operationId: randomUUID(),
  });
  const after = await world.thingDocument("mara", areaId),
    space = after.document.nodes[areaId].space!;
  expect(space.drawing!.strokes[0].points).toEqual(far.points);
  expect([space.width, space.depth]).toEqual([
    before.view.scene.width,
    before.view.scene.depth,
  ]);
  expect(after.document.nodes[areaId].media.background).toBeUndefined();
  expect((await snap()).placement).toEqual(before.placement);
  expect(drawingSvg({ version: 1, strokes: [far] }, 20, 16)).toContain(
    "M9000,8000 L9001,7999",
  );
  const svg = drawingSvg({ version: 1, strokes: [far] }, 20, 16);
  const box = svg
    .match(/viewBox="([^"]+)"/)![1]
    .split(" ")
    .map(Number);
  expect(box[0] + box[2]).toBeGreaterThan(9001);
  expect(box[1] + box[3]).toBeGreaterThan(8000);
});
