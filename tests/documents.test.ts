import { beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ThingDocumentSchema,
  validateGlb,
  type ThingDocument,
} from "../packages/shared/src/index";
import { World } from "../apps/server/src/world";
import { MemoryStore } from "../apps/server/src/store";
import { MemoryWiki } from "../apps/server/src/wiki";
import { seedDemo } from "../apps/server/src/demo";
let world: World,
  store: MemoryStore,
  wiki: MemoryWiki,
  areaId: string,
  characterId: string;
beforeEach(async () => {
  store = new MemoryStore();
  wiki = new MemoryWiki();
  world = new World(store, wiki);
  await seedDemo(world);
  const s = await store.read();
  areaId = Object.values(s.areas).find((a) => a.ownerId === "mara")!.id;
  characterId = Object.values(s.characters).find(
    (c) => c.ownerId === "mara",
  )!.id;
});
const save = async (
  root: string,
  draft: Awaited<ReturnType<World["thingDocument"]>>,
  op = randomUUID(),
) => world.saveThingDocument("mara", root, draft.revision, op, draft.document);
it("roundtrips area and character authoring documents while preserving publications and live records", async () => {
  const before = await store.read();
  for (const rootId of [areaId, characterId]) {
    const draft = await world.thingDocument("mara", rootId);
    expect(ThingDocumentSchema.safeParse(draft.document).success).toBe(true);
    const ids = Object.keys(draft.document.nodes);
    draft.document.nodes[rootId].name += " revised";
    const result = await save(rootId, draft);
    expect(Object.keys(result.document.nodes)).toEqual(ids);
    expect(result.document.nodes[rootId].name).toContain("revised");
    expect(result.document.nodes[rootId].character).toBe(
      rootId === characterId ? true : undefined,
    );
  }
  const after = await store.read();
  for (const key of [
    "publications",
    "sessions",
    "placements",
    "connections",
    "invitations",
    "messages",
  ] as const)
    expect(after[key]).toEqual(before[key]);
});
it("keeps globally scoped nested identities through renaming and reparenting", async () => {
  const draft = await world.thingDocument("mara", characterId);
  const doc = draft.document,
    id = `thing_${randomUUID()}`,
    bag = `thing_${randomUUID()}`;
  doc.nodes[bag] = {
    id: bag,
    name: "Bag",
    description: "",
    role: "inventory",
    media: {},
    space: {
      width: 8,
      depth: 8,
      zones: [],
      doors: [],
      anchors: [{ id: "arrival", name: "Arrival", position: [0, 0, 0] }],
    },
  };
  doc.nodes[id] = {
    id,
    name: "Sword",
    description: "old",
    role: "inventory",
    media: {},
    value: 7,
  };
  for (const childId of [bag, id])
    doc.placements.push({
      parentId: characterId,
      childId,
      position: [1, 2, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });
  const first = await save(characterId, draft);
  first.document.nodes[id].name = "Named sword";
  first.document.placements.find((p) => p.childId === id)!.parentId = bag;
  const second = await save(characterId, first);
  expect(second.document.nodes[id].name).toBe("Named sword");
  expect(
    second.document.placements.find((p) => p.childId === id)?.parentId,
  ).toBe(bag);
  expect(second.document.nodes[bag].space?.anchors[0].id).toBe("arrival");
});
it("deduplicates authoring retries and rejects stale writes and permission injection", async () => {
  const initial = await world.thingDocument("mara", areaId),
    op = randomUUID();
  initial.document.nodes[areaId].description = "A changed article";
  const first = await save(areaId, initial, op);
  expect(await save(areaId, initial, op)).toEqual(first);
  await expect(save(areaId, initial)).rejects.toMatchObject({
    code: "draft_conflict",
  });
  await expect(
    world.saveThingDocument(
      "lyra",
      areaId,
      first.revision,
      randomUUID(),
      first.document,
    ),
  ).rejects.toMatchObject({ code: "forbidden" });
  (first.document.nodes[areaId] as any).ownerId = "lyra";
  expect(ThingDocumentSchema.safeParse(first.document).success).toBe(false);
});
it("serves filtered published documents to readers, never their draft or private descendants", async () => {
  await world.share("mara", areaId, "lyra");
  const draft = await world.thingDocument("mara", areaId),
    id = `thing_${randomUUID()}`;
  draft.document.nodes[id] = {
    id,
    name: "Secret",
    description: "private prose",
    role: "inventory",
    visible: false,
    media: {},
  };
  draft.document.placements.push({
    parentId: areaId,
    childId: id,
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });
  await save(areaId, draft);
  await world.publish("mara", areaId);
  const newer = await world.thingDocument("mara", areaId);
  newer.document.nodes[areaId].description = "UNPUBLISHED PRIVATE CHANGE";
  await save(areaId, newer);
  const reader = await world.thingDocument("lyra", areaId);
  expect(reader.canEdit).toBe(false);
  expect(reader.canPublish).toBe(false);
  expect(reader.document.nodes[id]).toBeUndefined();
  expect(reader.document.nodes[areaId].description).not.toContain(
    "UNPUBLISHED",
  );
  await expect(
    world.saveThingDocument(
      "lyra",
      areaId,
      reader.revision,
      randomUUID(),
      reader.document,
    ),
  ).rejects.toMatchObject({ code: "forbidden" });
});
it("preserves character spaces, layout and independent image/model references", async () => {
  const draft = await world.thingDocument("mara", characterId),
    root = draft.document.nodes[characterId];
  root.space = {
    width: 12,
    depth: 10,
    zones: [
      {
        id: "pocket",
        name: "Pocket",
        x: -2,
        y: -2,
        width: 4,
        depth: 4,
        priority: 0,
      },
    ],
    doors: [],
    anchors: [{ id: "entry", name: "Entry", position: [0, 0, 0] }],
  };
  root.media = {
    token: { kind: "asset", assetId: "sample_token" },
    model: { kind: "asset", assetId: "sample_model" },
    artwork: {
      kind: "url",
      url: "https://example.test/art.png",
      type: "image",
    },
    background: { kind: "asset", assetId: "sample_map" },
  };
  root.visual = {
    mode: "model",
    width: 1,
    height: 2,
    anchor: [0.5, 0],
    footprint: [1, 1],
  };
  const result = await save(characterId, draft);
  expect(result.document.nodes[characterId].media).toEqual(root.media);
  expect(result.document.nodes[characterId].space).toEqual(root.space);
  result.document.nodes[characterId].visual!.mode = "token";
  expect(
    (await save(characterId, result)).document.nodes[characterId].media.model,
  ).toEqual(root.media.model);
});
it("rejects cyclic, disconnected, forged media and invalid transform documents", async () => {
  const draft = await world.thingDocument("mara", characterId);
  const id = `thing_${randomUUID()}`;
  draft.document.nodes[id] = {
    id,
    name: "Orphan",
    description: "",
    role: "inventory",
    media: {},
  };
  expect(ThingDocumentSchema.safeParse(draft.document).success).toBe(false);
  draft.document.placements.push({
    parentId: id,
    childId: id,
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });
  expect(ThingDocumentSchema.safeParse(draft.document).success).toBe(false);
  delete draft.document.nodes[id];
  draft.document.placements = [];
  draft.document.nodes[characterId].media.artwork = {
    kind: "url",
    url: "http://localhost/internal",
    type: "image",
  };
  expect(ThingDocumentSchema.safeParse(draft.document).success).toBe(false);
});
it("validates the bundled GLB and rejects dependency URLs and malformed binary containers", async () => {
  const file = await readFile("apps/web/public/assets/sample.glb"),
    bytes = file.buffer.slice(
      file.byteOffset,
      file.byteOffset + file.byteLength,
    ) as ArrayBuffer;
  expect(() => validateGlb(bytes)).not.toThrow();
  expect(() => validateGlb(new ArrayBuffer(32))).toThrow();
  const encode = (json: any) => {
    const raw = Buffer.from(JSON.stringify(json));
    const padded = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32);
    raw.copy(padded);
    const result = Buffer.alloc(20 + padded.length);
    result.writeUInt32LE(0x46546c67, 0);
    result.writeUInt32LE(2, 4);
    result.writeUInt32LE(result.length, 8);
    result.writeUInt32LE(padded.length, 12);
    result.writeUInt32LE(0x4e4f534a, 16);
    padded.copy(result, 20);
    return result.buffer.slice(
      result.byteOffset,
      result.byteOffset + result.byteLength,
    ) as ArrayBuffer;
  };
  expect(() =>
    validateGlb(
      encode({
        asset: { version: "2.0" },
        buffers: [{ uri: "https://example.test/private.bin", byteLength: 0 }],
      }),
    ),
  ).toThrow(/Embed/);
});

it("reserves new identities to their document and keeps scoped legacy IDs distinct", async () => {
  const first = await world.thingDocument("mara", characterId),
    id = `thing_${randomUUID()}`;
  first.document.nodes[id] = {
    id,
    name: "Unique item",
    description: "",
    role: "inventory",
    media: {},
  };
  first.document.placements.push({
    parentId: characterId,
    childId: id,
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });
  await save(characterId, first);
  const other = await world.thingDocument("mara", areaId);
  other.document.nodes[id] = structuredClone(first.document.nodes[id]);
  other.document.placements.push({
    parentId: areaId,
    childId: id,
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });
  await expect(save(areaId, other)).rejects.toMatchObject({
    code: "identity_conflict",
  });
  const restored = new World(new MemoryStore(await store.read()), wiki);
  expect(
    (await restored.thingDocument("mara", characterId)).document.nodes[id].name,
  ).toBe("Unique item");
});
