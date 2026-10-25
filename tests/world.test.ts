import { beforeEach, describe, expect, it } from "vitest";
import {
  emptyScene,
  AreaSceneSchema,
  zoneAt,
  type WorldState,
} from "../packages/shared/src/index";
import { MemoryStore } from "../apps/server/src/store";
import { MemoryWiki } from "../apps/server/src/wiki";
import { World, hash } from "../apps/server/src/world";
import { seedDemo } from "../apps/server/src/demo";
let world: World, wiki: MemoryWiki, store: MemoryStore, state: WorldState;
beforeEach(async () => {
  store = new MemoryStore();
  wiki = new MemoryWiki();
  world = new World(store, wiki);
  await seedDemo(world);
  state = await store.read();
});
const first = () => Object.values(state.sessions)[0];
const character = (actor = "mara") =>
  Object.values(state.characters).find((c) => c.ownerId === actor)!;
const area = (actor = "mara") =>
  Object.values(state.areas).find((a) => a.ownerId === actor)!;
async function joined(actor = "mara") {
  const session = first(),
    c = character(actor);
  await world.join(actor, session.id, c.id);
  return { session, c };
}
describe("published world isolation", () => {
  it("keeps wiki edits and later publications out of active sessions", async () => {
    const { session, c } = await joined(),
      before = world.snapshot(await store.read(), "mara", session.id, c.id);
    wiki.pages.get(area().articleId)!.content = "A changed tavern";
    await world.publish("mara", area().id);
    const after = world.snapshot(await store.read(), "mara", session.id, c.id);
    expect(after.publication.id).toBe(before.publication.id);
    expect(after.publication.article).toBe(before.publication.article);
    const later = await world.createSession("mara", "New session", [area().id]);
    expect(later.pins[area().id]).not.toBe(before.publication.id);
  });
  it("plays and chats through wiki downtime while authoring fails", async () => {
    const { session, c } = await joined();
    wiki.available = false;
    expect(
      world.snapshot(await store.read(), "mara", session.id, c.id).publication
        .name,
    ).toContain("Tavern");
    await world.command("mara", {
      type: "chat",
      operationId: "chat",
      sessionId: session.id,
      characterId: c.id,
      channel: "speech",
      text: "Hello",
    });
    await expect(world.publish("mara", area().id)).rejects.toMatchObject({
      code: "wiki_unavailable",
    });
  });
  it("rejects stale saves and out-of-editor scene changes", async () => {
    const a = area(),
      draft = await world.draft("mara", a.id);
    await expect(
      world.saveScene("mara", a.id, 0, draft.scene),
    ).rejects.toMatchObject({ code: "draft_conflict" });
    wiki.pages.get(a.scenePageId)!.content = JSON.stringify({
      ...draft.scene,
      width: 30,
    });
    await expect(world.publish("mara", a.id)).rejects.toMatchObject({
      code: "draft_conflict",
    });
  });
});

it("keeps live commands responsive while a wiki publication is waiting", async () => {
  const { session, c } = await joined();
  const original = wiki.read.bind(wiki);
  let unblock!: () => void, signal!: () => void;
  const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    }),
    started = new Promise<void>((resolve) => {
      signal = resolve;
    });
  wiki.read = async (pageId) => {
    if (pageId === area().scenePageId) {
      signal();
      await gate;
      throw Object.assign(new Error("offline"), { code: "wiki_unavailable" });
    }
    return original(pageId);
  };
  const publication = world.publish("mara", area().id).catch((error) => error);
  await started;
  try {
    await world.command("mara", {
      type: "chat",
      operationId: "while-authoring",
      sessionId: session.id,
      characterId: c.id,
      channel: "ooc",
      text: "We can keep playing",
    });
    expect(Object.values((await store.read()).messages)).toHaveLength(1);
  } finally {
    unblock();
  }
  expect((await publication).code).toBe("wiki_unavailable");
  expect(Object.values((await store.read()).messages)).toHaveLength(1);
}, 3000);

describe("authority and transactions", () => {
  it("denies ungranted area access and scene edits", async () => {
    await expect(world.draft("rowan", area().id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      world.saveScene("rowan", area().id, 1, emptyScene()),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("rejects forged control, membership, and out-of-bounds moves", async () => {
    const { session, c } = await joined();
    const command = {
      type: "move" as const,
      operationId: "move",
      sessionId: session.id,
      characterId: c.id,
      revision: 0,
      position: [1, -1, 0] as [number, number, number],
    };
    await expect(world.command("rowan", command)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      world.command("mara", { ...command, position: [999, 0, 0] }),
    ).rejects.toMatchObject({ code: "out_of_bounds" });
    await world.removePlayer("mara", session.id, "lyra");
    await expect(
      world.join("lyra", session.id, character("lyra").id),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("deduplicates retries and rejects reused IDs with different payloads", async () => {
    const { session, c } = await joined();
    const cmd = {
      type: "move" as const,
      operationId: "op",
      sessionId: session.id,
      characterId: c.id,
      revision: 0,
      position: [2, -2, 0] as [number, number, number],
    };
    const results = await Promise.all([
      world.command("mara", cmd),
      world.command("mara", cmd),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect((await store.read()).placements[c.id].revision).toBe(1);
    await expect(
      world.command("mara", { ...cmd, position: [3, -3, 0] }),
    ).rejects.toMatchObject({ code: "operation_conflict" });
  });
  it("accepts only one of two moves based on the same placement revision", async () => {
    const { session, c } = await joined();
    const cmd = {
      type: "move" as const,
      sessionId: session.id,
      characterId: c.id,
      revision: 0,
      position: [2, -2, 0] as [number, number, number],
    };
    const r = await Promise.allSettled([
      world.command("mara", { ...cmd, operationId: "one" }),
      world.command("mara", { ...cmd, operationId: "two" }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(
      Object.values((await store.read()).outbox).some((e) => e.type === "move"),
    ).toBe(true);
  });
  it("keeps a character in only one active session", async () => {
    const { c } = await joined();
    const second = await world.createSession("mara", "Other", [area().id]);
    await expect(world.join("mara", second.id, c.id)).rejects.toMatchObject({
      code: "already_placed",
    });
  });
  it("restores placement and messages in a fresh service instance", async () => {
    const { session, c } = await joined();
    await world.command("mara", {
      type: "move",
      operationId: "persist",
      sessionId: session.id,
      characterId: c.id,
      revision: 0,
      position: [-5, 4, 0],
    });
    await world.command("mara", {
      type: "chat",
      operationId: "persist-chat",
      sessionId: session.id,
      characterId: c.id,
      channel: "ooc",
      text: "See you tomorrow",
    });
    const restarted = new World(store, wiki);
    const snapshot = restarted.snapshot(
      await store.read(),
      "mara",
      session.id,
      c.id,
    );
    expect(snapshot.placement.zoneId).toBe("bar");
    expect(snapshot.messages[0].text).toBe("See you tomorrow");
  });
});
describe("connections and travel", () => {
  it("inherits approved area links in a separately hosted session", async () => {
    const session = await world.createSession("rowan", "Rowan's evening", [
      area("rowan").id,
    ]);
    expect(session.allowedAreaIds).toContain(area("mara").id);
    const c = character("rowan");
    await world.join("rowan", session.id, c.id);
    const before = world.snapshot(
      await store.read(),
      "rowan",
      session.id,
      c.id,
    );
    expect(before.exits).toHaveLength(1);
    await world.command("rowan", {
      type: "travel",
      operationId: "rowan-upstairs",
      sessionId: session.id,
      characterId: c.id,
      revision: before.placement.revision,
      connectionId: before.exits[0].connectionId,
    });
    const after = world.snapshot(await store.read(), "rowan", session.id, c.id);
    expect(after.placement.areaId).toBe(area("mara").id);
    expect(after.exits).toHaveLength(1);
    expect(after.occupants).toHaveLength(1);
  });
  it("does not include linked areas without host play access", async () => {
    await store.transaction((s) => {
      s.areas[area("mara").id].sharedWith = [];
    });
    const session = await world.createSession("rowan", "Private basement", [
      area("rowan").id,
    ]);
    expect(session.allowedAreaIds).toEqual([area("rowan").id]);
  });
  it("does not inherit disabled connections or unpublished endpoint changes", async () => {
    const back = Object.values(state.connections).find(
      (c) => c.sourceAreaId === area("rowan").id,
    )!;
    await world.disable("rowan", back.id);
    const disabled = await world.createSession("rowan", "Disabled stairs", [
      area("rowan").id,
    ]);
    expect(disabled.allowedAreaIds).toEqual([area("rowan").id]);
    await store.transaction((s) => {
      s.connections[back.id].enabled = true;
      s.connections[back.id].targetEndpointHash = "unpublished-change";
    });
    const stale = await world.createSession("rowan", "Changed arrival", [
      area("rowan").id,
    ]);
    expect(stale.allowedAreaIds).toEqual([area("rowan").id]);
  });
  it("keeps invitation rights distinct from source editing", async () => {
    const inv = await world.inviteConnection(
      "mara",
      area().id,
      "stairs",
      "rowan",
    );
    expect(inv.status).toBe("pending");
    await expect(world.draft("rowan", area().id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(world.accept("rowan", inv.id)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
  it("rejects a proposal when the source endpoint revision changes", async () => {
    const inv = await world.inviteConnection(
      "mara",
      area().id,
      "stairs",
      "rowan",
    );
    const draft = await world.draft("mara", area().id);
    await world.saveScene("mara", area().id, draft.scene.revision, draft.scene);
    await expect(
      world.propose("rowan", inv.id, area("rowan").id, "entrance"),
    ).rejects.toMatchObject({ code: "stale_invitation" });
  });
  it("travels using pinned endpoints and leaves source intact on failure", async () => {
    const { session, c } = await joined();
    const connection = Object.values(state.connections).find(
      (c) => c.sourceAreaId === area().id,
    )!;
    await world.disable("rowan", connection.id);
    const before = (await store.read()).placements[c.id];
    await expect(
      world.command("mara", {
        type: "travel",
        operationId: "travel",
        sessionId: session.id,
        characterId: c.id,
        revision: 0,
        connectionId: connection.id,
      }),
    ).rejects.toMatchObject({ code: "exit_unavailable" });
    expect((await store.read()).placements[c.id]).toEqual(before);
  });
  it("moves between areas and filters local speech", async () => {
    const { session, c } = await joined();
    const other = character("rowan");
    await world.join("rowan", session.id, other.id);
    await world.command("mara", {
      type: "chat",
      operationId: "local",
      sessionId: session.id,
      characterId: c.id,
      channel: "speech",
      text: "Upstairs only",
    });
    const connection = Object.values(state.connections).find(
      (c) => c.sourceAreaId === area().id,
    )!;
    await world.command("rowan", {
      type: "travel",
      operationId: "travel",
      sessionId: session.id,
      characterId: other.id,
      revision: 0,
      connectionId: connection.id,
    });
    const snapshot = world.snapshot(
      await store.read(),
      "rowan",
      session.id,
      other.id,
    );
    expect(snapshot.publication.name).toContain("Basement");
    expect(snapshot.messages).toHaveLength(0);
    expect(snapshot.occupants.map((x) => x.character.id)).not.toContain(c.id);
  });
  it("prevents travel when host destination access is withdrawn", async () => {
    const { session, c } = await joined();
    const connection = Object.values(state.connections).find(
      (c) => c.sourceAreaId === area().id,
    )!;
    await store.transaction((s) => {
      s.areas[connection.targetAreaId].sharedWith = [];
    });
    await expect(
      world.command("mara", {
        type: "travel",
        operationId: "travel",
        sessionId: session.id,
        characterId: c.id,
        revision: 0,
        connectionId: connection.id,
      }),
    ).rejects.toMatchObject({ code: "admission_denied" });
  });
});
describe("scene validation", () => {
  it("rejects duplicate IDs, invalid rotations, and missing arrival points", () => {
    const s = emptyScene();
    expect(
      AreaSceneSchema.safeParse({ ...s, doors: [s.anchors[0]] }).success,
    ).toBe(false);
    expect(AreaSceneSchema.safeParse({ ...s, anchors: [] }).success).toBe(
      false,
    );
  });
  it("resolves overlapping zones deterministically", () => {
    const s = {
      ...emptyScene(),
      zones: [
        { id: "b", name: "B", x: 0, y: 0, width: 4, depth: 4, priority: 1 },
        { id: "a", name: "A", x: 0, y: 0, width: 4, depth: 4, priority: 1 },
      ],
    };
    expect(zoneAt(s, [0, 0, 0])).toBe("a");
    expect(zoneAt(s, [8, 0, 0])).toBe("common");
  });
  it("detects missing assets on save without persisting changes", async () => {
    const draft = await world.draft("mara", area().id);
    draft.scene.things[0].visual!.assetId = "missing-image";
    await expect(
      world.saveScene("mara", area().id, draft.scene.revision, draft.scene),
    ).rejects.toMatchObject({ code: "invalid_asset" });
    expect((await store.read()).areas[area().id].sceneRevision).toBe(
      state.areas[area().id].sceneRevision,
    );
  });
  it("rejects using another owner’s private image in a new scene", async () => {
    await store.transaction((s) => {
      s.assets.secret = {
        id: "secret",
        ownerId: "rowan",
        key: "private",
        mime: "image/webp",
        width: 1,
        height: 1,
      };
    });
    const draft = await world.draft("mara", area().id);
    draft.scene.things[0].visual!.assetId = "secret";
    await expect(
      world.saveScene("mara", area().id, draft.scene.revision, draft.scene),
    ).rejects.toMatchObject({ code: "forbidden_asset" });
  });
});

describe("content tags", () => {
  it("normalizes tags and captures them only in new publications", async () => {
    const a = area();
    const old = (await store.read()).publications[a.latestPublicationId!];
    await world.setAreaTags("mara", a.id, [" Setting ", "setting", "Tavern"]);
    expect((await store.read()).areas[a.id].tags).toEqual([
      "setting",
      "tavern",
    ]);
    expect(
      (await world.library("mara")).areas.find((x) => x.id === a.id)?.tags,
    ).toEqual(["setting", "tavern"]);
    const published = await world.publish("mara", a.id);
    expect(published.tags).toEqual(["setting", "tavern"]);
    expect((await store.read()).publications[old.id]).toEqual(old);
    await expect(
      world.setAreaTags("rowan", a.id, ["vehicle"]),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("supports tags on characters and nested Things without changing legacy scenes", async () => {
    const c = character();
    await world.updateCharacter("mara", c.id, {
      tags: ["Character", "character"],
    });
    expect((await store.read()).characters[c.id].tags).toEqual(["character"]);
    await expect(
      world.updateCharacter("rowan", c.id, { tags: ["item"] }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const scene = emptyScene();
    expect(AreaSceneSchema.parse(scene)).toEqual(scene);
    scene.things.push({
      id: "wagon",
      name: "Wagon",
      description: "",
      role: "spatial",
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      children: [],
      tags: ["Vehicle", "vehicle"],
    });
    expect(AreaSceneSchema.parse(scene).things[0].tags).toEqual(["vehicle"]);
    scene.things[0].tags = ["x".repeat(33)];
    expect(AreaSceneSchema.safeParse(scene).success).toBe(false);
  });
});

describe("published article exit catalog", () => {
  it("links approved destinations without changing placement or session pins", async () => {
    const { session, c } = await joined();
    const before = await store.read();
    const article = await world.article("mara", area().id, session.id);
    const exit = article.exits.find((e) => e.status === "connected")!;
    expect(exit.destinationName).toBeTruthy();
    expect(exit.targetAreaId).toBeTruthy();
    const target = await world.article("mara", exit.targetAreaId!, session.id);
    expect(target.name).toBe(exit.destinationName);
    const after = await store.read();
    expect(after.placements[c.id]).toEqual(before.placements[c.id]);
    expect(after.sessions[session.id].pins).toEqual(
      before.sessions[session.id].pins,
    );
    await world.removePlayer("mara", session.id, "rowan");
    await expect(
      world.article("rowan", area().id, session.id),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("hides disabled or inaccessible destinations and respects pinned prose", async () => {
    const a = area();
    const { session } = await joined();
    const original = await world.article("mara", a.id, session.id);
    const linked = original.exits.find((e) => e.targetAreaId)!;
    wiki.pages.get(a.articleId)!.content = "Updated prose";
    await world.publish("mara", a.id);
    expect((await world.article("mara", a.id, session.id)).article).toBe(
      original.article,
    );
    expect((await world.article("mara", a.id)).article).toBe("Updated prose");
    await store.transaction((s) => {
      s.areas[linked.targetAreaId!].sharedWith = [];
    });
    const hidden = (await world.article("mara", a.id, session.id)).exits.find(
      (e) => e.doorId === linked.doorId,
    )!;
    expect(hidden).toEqual({
      doorId: linked.doorId,
      name: linked.name,
      status: "unavailable",
    });
    await expect(
      world.article("mara", linked.targetAreaId!),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

it("catalogs unconnected doors and removes disabled or stale exit links", async () => {
  const a = area();
  const before = await world.article("mara", a.id);
  const linked = before.exits.find((e) => e.targetAreaId)!;
  const connection = Object.values((await store.read()).connections).find(
    (c) => c.sourceAreaId === a.id && c.doorId === linked.doorId,
  )!;
  await store.transaction((s) => {
    s.connections[connection.id].enabled = false;
  });
  expect(
    (await world.article("mara", a.id)).exits.find(
      (e) => e.doorId === linked.doorId,
    ),
  ).toEqual({
    doorId: linked.doorId,
    name: linked.name,
    status: "unavailable",
  });
  await store.transaction((s) => {
    s.connections[connection.id].enabled = true;
  });
  const draft = await world.draft("mara", a.id);
  draft.scene.doors.find((d) => d.id === linked.doorId)!.name =
    "Changed endpoint";
  draft.scene.doors.push({
    ...draft.scene.doors[0],
    id: "unexplored_door",
    name: "Unexplored door",
  });
  await world.saveScene("mara", a.id, draft.area.sceneRevision, draft.scene);
  await world.publish("mara", a.id);
  const after = await world.article("mara", a.id);
  expect(after.exits.find((e) => e.doorId === linked.doorId)?.status).toBe(
    "unavailable",
  );
  expect(after.exits.find((e) => e.doorId === "unexplored_door")).toEqual({
    doorId: "unexplored_door",
    name: "Unexplored door",
    status: "unexplored",
  });
});
