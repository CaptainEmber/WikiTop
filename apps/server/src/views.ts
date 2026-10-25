import {
  emptyScene,
  type Thing,
  type Space,
  type ViewTarget,
  type ViewedSpace,
  type WorldState,
  type PlaySession,
  type Placement,
} from "@wikitop/shared";
import { controls, inventory, sceneThings } from "./live-things.js";
import { randomUUID } from "node:crypto";
import { requireThat } from "./errors.js";
const defaultSpace: Space = { width: 20, depth: 16 };
export const locationView: ViewTarget = { kind: "location" };
export function normalizeThings(things: Thing[], privateByDefault: boolean) {
  for (const t of things) {
    t.visible ??= !privateByDefault;
    t.peerable ??= !privateByDefault && t.contentsVisibility !== "controllers";
    normalizeThings(t.children, privateByDefault);
  }
}
export function arrangeLegacy(things: Thing[], space: Space = defaultSpace) {
  const positions = new Set<string>();
  const overlaps = things.some((t) => {
    const key = t.position.join(",");
    const duplicate = positions.has(key);
    positions.add(key);
    return (
      duplicate ||
      Math.abs(t.position[0]) > space.width / 2 ||
      Math.abs(t.position[1]) > space.depth / 2
    );
  });
  if (overlaps) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(things.length))),
      rows = Math.ceil(things.length / cols);
    things.forEach((t, i) => {
      t.position = [
        -space.width / 2 + (((i % cols) + 0.5) * space.width) / cols,
        space.depth / 2 - ((Math.floor(i / cols) + 0.5) * space.depth) / rows,
        0,
      ];
    });
  }
  things.forEach((t) => arrangeLegacy(t.children, t.space));
}
export function copyCharacterInventory(
  things: Thing[],
  rootId?: string,
): Thing[] {
  return structuredClone(things).map(function copy(t): Thing {
    return {
      ...t,
      templateId: t.id,
      templateRootId: rootId,
      id: randomUUID(),
      children: t.children.map(copy),
    };
  });
}
export function prepareViews(s: WorldState, session: PlaySession) {
  session.inventories ??= {};
  session.characterFlags ??= {};
  session.characterSpaces ??= {};
  for (const [cid, items] of Object.entries(session.inventories)) {
    const c = s.characters[cid];
    if (!session.characterFlags[cid]) {
      session.characterFlags[cid] = {
        visible: c.visible ?? true,
        peerable: c.peerable ?? true,
      };
      session.characterSpaces[cid] = structuredClone(c.space ?? defaultSpace);
      const own = (ts: Thing[]) => {
        for (const t of ts) {
          t.ownerId = c.ownerId;
          own(t.children);
        }
      };
      own(items);
      normalizeThings(items, true);
      arrangeLegacy(items, session.characterSpaces[cid]);
    }
  }
  session.liveThings ??= {};
  for (const areaId of Object.keys(session.pins)) {
    if (!session.liveThings[areaId] || session.viewFormat !== 1) {
      session.liveThings[areaId] ??= structuredClone(
        s.publications[session.pins[areaId]].scene.things,
      );
      normalizeThings(session.liveThings[areaId], false);
      session.liveThings[areaId].forEach((t) =>
        arrangeLegacy(t.children, t.space),
      );
    }
  }
  session.viewFormat = 1;
}
export function thingOwner(
  s: WorldState,
  session: PlaySession,
  root: "area" | "character",
  rootId: string,
  t?: Thing,
) {
  return (
    t?.ownerId ||
    (root === "character"
      ? s.characters[rootId].ownerId
      : s.areas[rootId].ownerId)
  );
}
export function projectThings(
  s: WorldState,
  session: PlaySession,
  actor: string,
  root: "area" | "character",
  rootId: string,
  things: Thing[],
): Thing[] {
  return things
    .filter(
      (t) =>
        thingOwner(s, session, root, rootId, t) === actor ||
        (t.visible ?? root === "area"),
    )
    .map((t) => ({
      ...t,
      space:
        thingOwner(s, session, root, rootId, t) === actor || t.peerable
          ? t.space
          : undefined,
      children:
        thingOwner(s, session, root, rootId, t) === actor ||
        (t.peerable ??
          (root === "area" && t.contentsVisibility !== "controllers"))
          ? projectThings(s, session, actor, root, rootId, t.children)
          : [],
    }));
}
export function characterVisible(
  s: WorldState,
  session: PlaySession,
  actor: string,
  id: string,
) {
  return (
    s.characters[id].ownerId === actor ||
    (session.characterFlags?.[id]?.visible ?? s.characters[id].visible ?? true)
  );
}
export function characterPeerable(
  s: WorldState,
  session: PlaySession,
  actor: string,
  id: string,
) {
  return (
    s.characters[id].ownerId === actor ||
    (characterVisible(s, session, actor, id) &&
      (session.characterFlags?.[id]?.peerable ??
        s.characters[id].peerable ??
        true))
  );
}
export interface ViewContext {
  target: ViewTarget;
  name: string;
  things: Thing[];
  space: Space;
  ownerId: string;
  canArrange: boolean;
  root: "area" | "character";
  rootId: string;
  breadcrumbs: ViewedSpace["breadcrumbs"];
  backgroundAssetId?: string;
}
export function resolveView(
  s: WorldState,
  session: PlaySession,
  actor: string,
  p: Placement,
  target: ViewTarget,
): ViewContext {
  const breadcrumbs: ViewedSpace["breadcrumbs"] = [
    { name: s.publications[session.pins[p.areaId]].name, target: locationView },
  ];
  if (target.kind === "location")
    return {
      target,
      name: breadcrumbs[0].name,
      things: sceneThings(s, session, p.areaId),
      space: s.publications[session.pins[p.areaId]].scene,
      backgroundAssetId:
        s.publications[session.pins[p.areaId]].thingFields?.space
          ?.backgroundAssetId,
      ownerId: s.areas[p.areaId].ownerId,
      canArrange: session.hostId === actor,
      root: "area",
      rootId: p.areaId,
      breadcrumbs,
    };
  let things: Thing[],
    ownerId: string,
    name: string,
    space: Space,
    backgroundAssetId: string | undefined,
    canArrange: boolean;
  if (target.root === "character") {
    const c = s.characters[target.rootId],
      placement = s.placements[target.rootId];
    requireThat(
      c &&
        placement?.sessionId === session.id &&
        (target.rootId === p.characterId || placement.areaId === p.areaId) &&
        characterPeerable(s, session, actor, c.id),
      "view_unavailable",
      "This character is no longer available to peer into",
      403,
    );
    things = inventory(s, session, c.id);
    ownerId = c.ownerId;
    name = c.name;
    space = session.characterSpaces?.[c.id] ?? c.space ?? defaultSpace;
    backgroundAssetId = space.backgroundAssetId ?? c.imageAssetId;
    canArrange = controls(s, session, actor, p.areaId, c.id);
    breadcrumbs.push({ name, target: { ...target, path: [] } });
  } else {
    requireThat(
      target.rootId === p.areaId && target.path.length > 0,
      "view_unavailable",
      "That space is unavailable here",
      403,
    );
    things = sceneThings(s, session, p.areaId);
    ownerId = s.areas[p.areaId].ownerId;
    name = breadcrumbs[0].name;
    space = defaultSpace;
    canArrange = session.hostId === actor;
  }
  const path: string[] = [];
  for (const id of target.path) {
    const t = things.find((t) => t.id === id);
    requireThat(t, "view_unavailable", "This container is unavailable", 403);
    const owner = thingOwner(s, session, target.root, target.rootId, t);
    requireThat(
      owner === actor ||
        ((t!.visible ?? target.root === "area") &&
          (t!.peerable ??
            (target.root === "area" &&
              t!.contentsVisibility !== "controllers"))),
      "view_unavailable",
      "This container is hidden or closed",
      403,
    );
    ownerId = owner;
    name = t!.name;
    space = t!.space ?? defaultSpace;
    backgroundAssetId = space.backgroundAssetId ?? t!.imageAssetId;
    things = t!.children;
    canArrange =
      owner === actor ||
      (target.root === "character"
        ? controls(s, session, actor, p.areaId, target.rootId)
        : controls(s, session, actor, p.areaId, t!.id));
    path.push(id);
    breadcrumbs.push({ name, target: { ...target, path: [...path] } });
  }
  return {
    target,
    name,
    things,
    space,
    ownerId,
    canArrange,
    root: target.root,
    rootId: target.rootId,
    breadcrumbs,
    backgroundAssetId,
  };
}
export function viewSnapshot(
  s: WorldState,
  session: PlaySession,
  actor: string,
  p: Placement,
  target: ViewTarget = locationView,
): ViewedSpace {
  const context = resolveView(s, session, actor, p, target);
  const things = projectThings(
    s,
    session,
    actor,
    context.root,
    context.rootId,
    context.things,
  );
  const scene =
    target.kind === "location"
      ? { ...s.publications[session.pins[p.areaId]].scene, things }
      : {
          ...emptyScene(),
          width: context.space.width,
          depth: context.space.depth,
          things,
          zones: [],
          doors: [],
          anchors: [
            {
              id: "_view_origin",
              name: "Origin",
              position: [0, 0, 0] as [number, number, number],
            },
          ],
        };
  return {
    target,
    name: context.name,
    scene,
    breadcrumbs: context.breadcrumbs,
    ownerId: context.ownerId,
    canArrange: context.canArrange,
    backgroundAssetId: context.backgroundAssetId,
    controllableIds: things
      .filter((t) =>
        target.kind === "location"
          ? controls(s, session, actor, p.areaId, t.id)
          : context.canArrange ||
            thingOwner(s, session, context.root, context.rootId, t) === actor,
      )
      .map((t) => t.id),
    peerableIds: things
      .filter(
        (t) =>
          thingOwner(s, session, context.root, context.rootId, t) === actor ||
          (t.peerable ??
            (context.root === "area" &&
              t.contentsVisibility !== "controllers")),
      )
      .map((t) => t.id),
    ownedIds: things
      .filter(
        (t) =>
          thingOwner(s, session, context.root, context.rootId, t) === actor,
      )
      .map((t) => t.id),
  };
}
