import { authReturnPath } from "../apps/server/src/auth";
import { beforeEach, expect, it } from "vitest";
import { MemoryStore } from "../apps/server/src/store";
import { MemoryWiki } from "../apps/server/src/wiki";
import { World } from "../apps/server/src/world";
import { seedDemo } from "../apps/server/src/demo";
let world: World, store: MemoryStore, areaId: string;
beforeEach(async () => {
  store = new MemoryStore();
  world = new World(store, new MemoryWiki());
  await seedDemo(world);
  areaId = Object.values((await store.read()).areas).find(
    (a) => a.ownerId === "mara",
  )!.id;
  const draft = await world.draft("mara", areaId);
  draft.scene.doors.push({
    id: "unwritten",
    name: "Unwritten door",
    position: [0, 0, 0],
  });
  await world.saveScene("mara", areaId, draft.area.sceneRevision, draft.scene);
  await world.publish("mara", areaId);
  await world.share("mara", areaId, "lyra");
});
it("lets the owner create a connected draft without publishing or changing live pins", async () => {
  const before = await store.read();
  const result = await world.createBeyond(
    "mara",
    areaId,
    "unwritten",
    "Garden",
  );
  expect(result.approvalRequired).toBe(false);
  expect(result.area.ownerId).toBe("mara");
  expect(result.area.latestPublicationId).toBeUndefined();
  const after = await store.read();
  expect(after.sessions).toEqual(before.sessions);
  expect(after.publications).toEqual(before.publications);
  expect(
    Object.values(after.connections).find((c) => c.doorId === "unwritten")
      ?.targetAreaId,
  ).toBe(result.area.id);
  await expect(
    world.createBeyond("mara", areaId, "unwritten", "Duplicate"),
  ).rejects.toMatchObject({ code: "conflict" });
});
it("requires owner approval for requests and separate connection acceptance", async () => {
  const inv = await world.frontierInvite("lyra", areaId, "unwritten", true);
  expect(inv.status).toBe("requested");
  expect(
    (await world.frontierInvite("lyra", areaId, "unwritten", true)).id,
  ).toBe(inv.id);
  await expect(
    world.createBeyond("lyra", areaId, "unwritten", "Garden", inv.id),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    world.resolveFrontier("rowan", inv.id, true),
  ).rejects.toMatchObject({ code: "forbidden" });
  await world.resolveFrontier("mara", inv.id, true);
  const result = await world.createBeyond(
    "lyra",
    areaId,
    "unwritten",
    "Garden",
    inv.id,
  );
  expect(result.area.ownerId).toBe("lyra");
  expect(result.approvalRequired).toBe(true);
  await expect(world.draft("lyra", areaId)).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(
    Object.values((await store.read()).connections).some(
      (c) => c.doorId === "unwritten",
    ),
  ).toBe(false);
  await world.accept("mara", inv.id);
  await world.publish("lyra", result.area.id);
  expect(
    (await world.article("mara", areaId)).exits.find(
      (e) => e.doorId === "unwritten",
    )?.destinationName,
  ).toBe("Garden");
});
it("makes invitation links single-claim, revocable, and scoped to a door", async () => {
  const inv = await world.frontierInvite("mara", areaId, "unwritten");
  await world.claimFrontier("lyra", inv.id);
  await world.claimFrontier("lyra", inv.id);
  await expect(world.claimFrontier("rowan", inv.id)).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(
    world.createBeyond("lyra", areaId, "stairs", "Elsewhere", inv.id),
  ).rejects.toMatchObject({ code: "forbidden" });
  await world.resolveFrontier("mara", inv.id, false);
  await expect(
    world.createBeyond("lyra", areaId, "unwritten", "Garden", inv.id),
  ).rejects.toMatchObject({ code: "forbidden" });
});
it("rejects stale and unauthorized creation without new records", async () => {
  await store.transaction((s) => {
    s.areas[areaId].sharedWith = s.areas[areaId].sharedWith.filter(
      (id) => id !== "rowan",
    );
  });
  await expect(
    world.frontierInvite("rowan", areaId, "unwritten", true),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    world.frontierInvite("lyra", areaId, "unwritten"),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    world.createBeyond("lyra", areaId, "unwritten", "Garden"),
  ).rejects.toMatchObject({ code: "forbidden" });
  const inv = await world.frontierInvite("mara", areaId, "unwritten");
  await world.claimFrontier("lyra", inv.id);
  const draft = await world.draft("mara", areaId);
  draft.scene.doors.find((d) => d.id === "unwritten")!.name = "Changed";
  await world.saveScene("mara", areaId, draft.area.sceneRevision, draft.scene);
  const before = await store.read();
  await expect(
    world.createBeyond("lyra", areaId, "unwritten", "Garden", inv.id),
  ).rejects.toMatchObject({ code: "stale_invitation" });
  expect((await store.read()).areas).toEqual(before.areas);
});

it("preserves contribution links after login without allowing external redirects", () => {
  expect(authReturnPath("/contribute/test-id")).toBe("/contribute/test-id");
  expect(authReturnPath("/articles/test?sessionId=private")).toBe(
    "/articles/test?sessionId=private",
  );
  for (const path of [
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/contribute/test%0d%0aLocation:x",
    "/contribute/../auth/logout",
  ])
    expect(authReturnPath(path)).toBe("/");
});
