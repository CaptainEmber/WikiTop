import { describe, it, expect } from "vitest";
import {
  AreaSceneSchema,
  emptyScene,
  migrateSceneToZUp,
  rotateLegacyQuaternion,
  yUpToZUp,
  zoneAt,
  emptyState,
} from "../packages/shared/src/index";
import { migrateCoordinateState } from "../apps/server/src/coordinate-migration";
import { hash, World } from "../apps/server/src/world";
import { MemoryStore } from "../apps/server/src/store";
import { MemoryWiki } from "../apps/server/src/wiki";
import { seedDemo } from "../apps/server/src/demo";
const legacy = () => ({
  schemaVersion: 1,
  revision: 3,
  width: 20,
  depth: 16,
  things: [
    {
      id: "bag",
      name: "Bag",
      description: "",
      role: "spatial",
      position: [1, 2, 3],
      rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
      scale: [1, 2, 3],
      children: [
        {
          id: "sword",
          name: "Sword",
          description: "",
          role: "spatial",
          position: [1, 0, 2],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
          children: [],
        },
      ],
    },
  ],
  zones: [
    { id: "bar", name: "Bar", x: -5, z: -4, width: 8, depth: 4, priority: 1 },
  ],
  doors: [{ id: "door", name: "Door", position: [2, 0, -3] }],
  anchors: [{ id: "entrance", name: "Entrance", position: [0, 0, 5] }],
});
describe("Z-up world coordinates", () => {
  it("uses X/Y for ground bounds and zone membership; Z only changes elevation", () => {
    const scene = {
      ...emptyScene(),
      zones: [
        { id: "bar", name: "Bar", x: 3, y: 4, width: 2, depth: 2, priority: 1 },
      ],
    };
    expect(zoneAt(scene, [3, 4, 0])).toBe("bar");
    expect(zoneAt(scene, [3, 4, 20])).toBe("bar");
    expect(zoneAt(scene, [3, 0, 4])).toBe("common");
    expect(
      AreaSceneSchema.safeParse({
        ...scene,
        anchors: [{ id: "high", name: "High", position: [0, 0, 50] }],
      }).success,
    ).toBe(true);
    expect(
      AreaSceneSchema.safeParse({
        ...scene,
        anchors: [{ id: "outside", name: "Outside", position: [0, 50, 0] }],
      }).success,
    ).toBe(false);
  });
  it("rotates legacy position, orientation, scale, child transforms, zones, and endpoints", () => {
    const converted = migrateSceneToZUp(legacy());
    expect(converted.schemaVersion).toBe(2);
    expect(converted.things[0].position).toEqual([1, -3, 2]);
    expect(converted.things[0].scale).toEqual([1, 3, 2]);
    expect(converted.things[0].children[0].position).toEqual([1, -2, 0]);
    expect(converted.things[0].rotation[2]).toBeCloseTo(Math.SQRT1_2);
    expect(converted.things[0].rotation[1]).toBe(0);
    expect(converted.zones[0].y).toBe(4);
    expect(converted.doors[0].position).toEqual([2, 3, 0]);
    expect(converted.anchors[0].position).toEqual([0, -5, 0]);
    expect(migrateSceneToZUp(converted)).toEqual(converted);
  });
  it("does not interpret unconverted version 1 content as Z-up", () => {
    expect(AreaSceneSchema.safeParse(legacy()).success).toBe(false);
  });
  it("keeps approved connection hashes, publication pins, and placements consistent during migration", () => {
    const original = emptyState(),
      raw = legacy(),
      scene = raw as any;
    original.areas.area = {
      id: "area",
      name: "Area",
      ownerId: "mara",
      collaborators: [],
      sharedWith: [],
      articleId: 1,
      scenePageId: 2,
      sceneRevision: 3,
      sceneHash: hash(raw),
      latestPublicationId: "pub",
      createdAt: "now",
    };
    original.publications.pub = {
      id: "pub",
      areaId: "area",
      name: "Area",
      article: "Article",
      scene,
      articleHash: hash("Article"),
      sceneHash: hash(raw),
      articlePageId: 1,
      scenePageId: 2,
      publishedBy: "mara",
      createdAt: "now",
    };
    original.connections.link = {
      id: "link",
      sourceAreaId: "area",
      doorId: "door",
      targetAreaId: "area",
      anchorId: "entrance",
      sourceEndpointHash: hash(raw.doors[0]),
      targetEndpointHash: hash(raw.anchors[0]),
      enabled: true,
    };
    original.placements.hero = {
      id: "hero",
      characterId: "hero",
      sessionId: "session",
      areaId: "area",
      parentId: "area",
      position: [2, 0, -3],
      zoneId: "common",
      revision: 4,
    };
    original.sessions.session = {
      id: "session",
      name: "Session",
      hostId: "mara",
      memberIds: ["mara"],
      allowedAreaIds: ["area"],
      pins: { area: "pub" },
      createdAt: "now",
    };
    const migrated = migrateCoordinateState(original, { area: raw });
    expect(migrated.state.connections.link.enabled).toBe(true);
    expect(migrated.state.connections.link.sourceEndpointHash).toBe(
      hash(migrated.scenes.area.doors[0]),
    );
    expect(migrated.state.publications.pub.sceneHash).toBe(
      hash(migrated.scenes.area),
    );
    expect(migrated.state.placements.hero.position).toEqual([2, 3, 0]);
    expect(migrated.state.placements.hero.revision).toBe(5);
    expect(migrated.state.sessions.session.pins).toEqual({ area: "pub" });
    expect(original.placements.hero.position).toEqual([2, 0, -3]);
    expect(
      migrateCoordinateState(migrated.state, migrated.scenes).state,
    ).toEqual(migrated.state);
  });
  it("walks along X/Y and rejects elevation changes through the ground movement command", async () => {
    const store = new MemoryStore(),
      world = new World(store, new MemoryWiki());
    await seedDemo(world);
    const state = await store.read(),
      session = Object.values(state.sessions)[0],
      c = Object.values(state.characters).find((c) => c.ownerId === "mara")!;
    await world.join("mara", session.id, c.id);
    await world.command("mara", {
      type: "move",
      operationId: "xy",
      sessionId: session.id,
      characterId: c.id,
      revision: 0,
      position: [-5, 4, 0],
    });
    expect((await store.read()).placements[c.id].zoneId).toBe("bar");
    await expect(
      world.command("mara", {
        type: "move",
        operationId: "z",
        sessionId: session.id,
        characterId: c.id,
        revision: 1,
        position: [-5, 4, 1],
      }),
    ).rejects.toMatchObject({ code: "out_of_bounds" });
  });
});
