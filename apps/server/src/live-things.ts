import {
  zoneAt,
  flattenThings,
  type Thing,
  type WorldState,
  type PlaySession,
  type Placement,
  type Command,
} from "@wikitop/shared";
import { requireThat } from "./errors.js";
import {
  resolveView,
  projectThings,
  thingOwner,
  characterVisible,
} from "./views.js";
import { randomUUID } from "node:crypto";

export const controlKey = (areaId: string, thingId: string) =>
  `${areaId}:${thingId}`;
export function controls(
  s: WorldState,
  session: PlaySession,
  actor: string,
  areaId: string,
  targetId: string,
) {
  const character = s.characters[targetId];
  if (character)
    return (
      character.ownerId === actor ||
      (session.controllers?.[`character:${targetId}`] ?? []).includes(actor)
    );
  return (
    flattenThings(sceneThings(s, session, areaId)).some(
      (t) => t.id === targetId && t.ownerId === actor,
    ) ||
    s.areas[areaId]?.ownerId === actor ||
    session.hostId === actor ||
    (session.controllers?.[controlKey(areaId, targetId)] ?? []).includes(actor)
  );
}
export function sceneThings(
  s: WorldState,
  session: PlaySession,
  areaId: string,
) {
  return (
    session.liveThings?.[areaId] ??
    s.publications[session.pins[areaId]].scene.things
  );
}
export function inventory(
  s: WorldState,
  session: PlaySession,
  characterId: string,
) {
  return (
    session.inventories?.[characterId] ??
    s.characters[characterId]?.children ??
    []
  );
}
function remove(things: Thing[], id: string): Thing | undefined {
  const index = things.findIndex((t) => t.id === id);
  if (index >= 0) return things.splice(index, 1)[0];
  for (const t of things) {
    const found = remove(t.children, id);
    if (found) return found;
  }
}
function findAccessible(
  things: Thing[],
  id: string,
  canControl: (id: string) => boolean,
): Thing | undefined {
  for (const t of things) {
    if (t.id === id) return t;
    if (t.contentsVisibility !== "controllers" || canControl(t.id)) {
      const found = findAccessible(t.children, id, canControl);
      if (found) return found;
    }
  }
}
export function interact(
  s: WorldState,
  session: PlaySession,
  actor: string,
  p: Placement,
  command: Extract<Command, { type: "interact" }>,
) {
  requireThat(
    command.revision === (session.liveRevision ?? 0),
    "stale_scene",
    "The scene changed; try again with the current state",
    409,
  );
  const requestedView = command.viewTarget ?? { kind: "location" as const };
  const context = resolveView(s, session, actor, p, requestedView);
  if (
    (command.action === "move" || command.action === "flags") &&
    requestedView.kind === "interior"
  ) {
    const item = context.things.find((t) => t.id === command.targetId);
    requireThat(
      item &&
        projectThings(s, session, actor, context.root, context.rootId, [item])
          .length,
      "not_found",
      "Item is unavailable in this space",
      404,
    );
    const owner = thingOwner(s, session, context.root, context.rootId, item);
    if (command.action === "flags") {
      requireThat(
        owner === actor,
        "forbidden",
        "Only the owner can change visibility",
        403,
      );
      if (command.visible !== undefined) item!.visible = command.visible;
      if (command.peerable !== undefined) item!.peerable = command.peerable;
    } else {
      requireThat(
        context.canArrange || owner === actor,
        "forbidden",
        "You cannot arrange this space",
        403,
      );
      const pos = command.position;
      requireThat(
        pos &&
          pos[2] === 0 &&
          Math.abs(pos[0]) <= context.space.width / 2 &&
          Math.abs(pos[1]) <= context.space.depth / 2,
        "out_of_bounds",
        "Choose ground inside the viewed space",
      );
      item!.position = [...pos!];
    }
    session.liveRevision = (session.liveRevision ?? 0) + 1;
    return;
  }
  const canControl = (id: string) => controls(s, session, actor, p.areaId, id);
  const ownInventory = inventory(s, session, p.characterId);
  const things = sceneThings(s, session, p.areaId);
  const target = findAccessible(
    projectThings(s, session, actor, "area", p.areaId, things),
    command.targetId,
    () => false,
  );
  const carried = findAccessible(ownInventory, command.targetId, () => true);
  const other = Object.values(s.placements).find(
    (o) =>
      o.characterId === command.targetId &&
      o.sessionId === session.id &&
      o.areaId === p.areaId &&
      characterVisible(s, session, actor, o.characterId),
  );
  requireThat(
    target || carried || other,
    "not_found",
    "Thing is not available here",
    404,
  );
  if (command.action === "flags") {
    const owner = other
      ? s.characters[other.characterId].ownerId
      : thingOwner(s, session, "area", p.areaId, target);
    requireThat(
      owner === actor,
      "forbidden",
      "Only the owner can change visibility",
      403,
    );
    const flags = other
      ? session.characterFlags![other.characterId]
      : things.find((t) => t.id === command.targetId);
    requireThat(flags, "not_found", "Select a direct Thing or character", 404);
    if (command.visible !== undefined) flags!.visible = command.visible;
    if (command.peerable !== undefined) flags!.peerable = command.peerable;
  } else if (command.action === "control") {
    requireThat(
      other
        ? s.characters[other.characterId].ownerId === actor
        : thingOwner(s, session, "area", p.areaId, target) === actor,
      "forbidden",
      "Only the owner may delegate control",
      403,
    );
    requireThat(
      command.recipientId && session.memberIds.includes(command.recipientId),
      "forbidden",
      "Choose a session participant",
      403,
    );
    requireThat(
      !carried,
      "forbidden",
      "Inventory control follows its holder",
      403,
    );
    const key = other
      ? `character:${other.characterId}`
      : controlKey(p.areaId, command.targetId);
    session.controllers ??= {};
    // Selecting the owner/host clears delegates; otherwise this assigns one delegate.
    session.controllers[key] =
      command.recipientId === actor ? [] : [command.recipientId!];
  } else if (command.action === "move") {
    requireThat(
      requestedView.kind === "location",
      "invalid_target",
      "Select an item in the viewed space",
    );
    requireThat(
      canControl(command.targetId),
      "forbidden",
      "You do not control this Thing",
      403,
    );
    requireThat(
      other ||
        (things.some((t) => t.id === target?.id) && target?.role === "spatial"),
      "invalid_target",
      "Move a character or a Thing directly in this area",
    );
    const pos = command.position,
      scene = s.publications[session.pins[p.areaId]].scene;
    requireThat(
      pos &&
        pos[2] === 0 &&
        Math.abs(pos[0]) <= scene.width / 2 &&
        Math.abs(pos[1]) <= scene.depth / 2,
      "out_of_bounds",
      "Choose ground inside this area",
    );
    if (other) {
      other.position = pos!;
      other.zoneId = zoneAt(scene, pos!);
      other.revision++;
    } else {
      session.liveThings ??= {};
      session.liveThings[p.areaId] ??= structuredClone(things);
      session.liveThings[p.areaId].find(
        (t) => t.id === command.targetId,
      )!.position = pos!;
    }
  } else if (command.action === "take") {
    requireThat(
      requestedView.kind === "location" &&
        things.some((t) => t.id === command.targetId) &&
        target?.portable &&
        !target.interiorAreaId &&
        target.visual?.mode !== "map",
      "forbidden",
      "This Thing cannot be taken",
      403,
    );
    requireThat(
      ownInventory.length < 200 &&
        flattenThings(ownInventory).length + flattenThings([target!]).length <=
          500,
      "inventory_full",
      "Inventory is full",
    );
    session.liveThings ??= {};
    session.inventories ??= {};
    session.liveThings[p.areaId] ??= structuredClone(things);
    session.inventories[p.characterId] ??= structuredClone(ownInventory);
    const item = remove(session.liveThings[p.areaId], target!.id)!;
    // Each carried instance has a fresh identity to avoid collisions across areas.
    const rekey = (t: Thing): Thing => ({
      ...t,
      id: t.templateId ? t.id : randomUUID(),
      templateId: t.templateId ?? t.id,
      templateRootId: t.templateRootId ?? p.areaId,
      visible: false,
      peerable: false,
      ownerId: actor,
      children: t.children.map(rekey),
    });
    const instance = rekey(item);
    let x = 0,
      y = 0;
    while (
      session.inventories[p.characterId].some(
        (t) => t.position[0] === x && t.position[1] === y,
      )
    ) {
      x += 2;
      if (x > 8) {
        x = -8;
        y += 2;
      }
      if (y > 6) {
        x = -8;
        y = -6;
        break;
      }
    }
    session.inventories[p.characterId].push({
      ...instance,
      role: "inventory",
      position: [x, y, 0],
    });
  } else if (command.action === "drop") {
    requireThat(
      carried?.portable,
      "forbidden",
      "Only portable items in your inventory can be dropped",
      403,
    );
    requireThat(
      things.length < 200 &&
        flattenThings(things).length + flattenThings([carried!]).length <= 500,
      "area_full",
      "This area is full",
    );
    session.liveThings ??= {};
    session.inventories ??= {};
    session.liveThings[p.areaId] ??= structuredClone(things);
    session.inventories[p.characterId] ??= structuredClone(ownInventory);
    const occupied = new Set(flattenThings(things).map((t) => t.id));
    requireThat(
      !flattenThings([carried!]).some((t) => occupied.has(t.id)),
      "id_conflict",
      "A legacy item ID conflicts with this area's contents; choose another destination",
      409,
    );
    const item = remove(session.inventories[p.characterId], carried!.id)!;
    session.liveThings[p.areaId].push({
      ...item,
      role: "spatial",
      position: [...p.position],
    });
  } else if (command.action === "exit") {
    requireThat(
      command.targetId === p.characterId && p.interiorTrail?.length,
      "invalid_target",
      "You are not inside a nested area",
    );
    const previous = p.interiorTrail!.at(-1)!;
    const parent = s.areas[previous.areaId];
    requireThat(
      parent &&
        (parent.ownerId === session.hostId ||
          parent.collaborators.includes(session.hostId) ||
          parent.sharedWith.includes(session.hostId)),
      "forbidden",
      "Parent area play access was withdrawn",
      403,
    );
    p.interiorTrail!.pop();
    p.areaId = previous.areaId;
    p.parentId = previous.areaId;
    p.position = previous.position;
    p.zoneId = previous.zoneId;
    p.revision++;
  } else {
    const areaId = target?.interiorAreaId;
    requireThat(
      areaId && session.allowedAreaIds.includes(areaId),
      "forbidden",
      "Interior is not available in this session",
      403,
    );
    const area = s.areas[areaId!];
    requireThat(
      area &&
        (area.ownerId === session.hostId ||
          area.collaborators.includes(session.hostId) ||
          area.sharedWith.includes(session.hostId)),
      "forbidden",
      "Interior play access was withdrawn",
      403,
    );
    session.pins[areaId!] ??= area.latestPublicationId!;
    const pub = s.publications[session.pins[areaId!]];
    requireThat(pub, "not_found", "Interior is not published", 404);
    requireThat(
      (p.interiorTrail?.length ?? 0) < 12 &&
        areaId !== p.areaId &&
        !p.interiorTrail?.some((entry) => entry.areaId === areaId),
      "invalid_target",
      "Interior nesting would form a loop or exceed the limit",
    );
    p.interiorTrail ??= [];
    p.interiorTrail.push({
      areaId: p.areaId,
      position: [...p.position],
      zoneId: p.zoneId,
    });
    p.areaId = areaId!;
    p.parentId = areaId!;
    p.position = [...pub.scene.anchors[0].position];
    p.zoneId = zoneAt(pub.scene, p.position);
    p.revision++;
  }
  session.liveRevision = (session.liveRevision ?? 0) + 1;
}

export function publicSession(session: PlaySession): PlaySession {
  const {
    drawings: _drawings,
    controllers: _controllers,
    viewFormat: _format,
    liveThings: _live,
    inventories: _inventories,
    characterFlags: _flags,
    characterSpaces: _spaces,
    ...result
  } = session;
  return result;
}
