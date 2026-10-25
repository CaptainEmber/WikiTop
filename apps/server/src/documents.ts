import { createHash } from "node:crypto";
import {
  DocumentThingSchema,
  emptyScene,
  type ThingDocument,
  type DocumentThing,
  type Thing,
  type AreaScene,
  type Area,
  type Character,
  type WorldState,
  type MediaReference,
} from "@wikitop/shared";
export const nodeId = (rootId: string, legacyId: string, state?: WorldState) =>
  state?.thingIds?.[legacyId]?.rootId === rootId
    ? legacyId
    : `thing_${createHash("sha256").update(`${rootId}:${legacyId}`).digest("hex").slice(0, 40)}`;
export function exportDocument(
  s: WorldState,
  root: Area | Character,
  description: string,
  children: Thing[],
  scene?: AreaScene,
): ThingDocument {
  const character = "assetId" in root || !!s.characters[root.id];
  const fields: Partial<Thing> = character
    ? {
        ...(root as Character).thingFields,
        visual: (root as Character).visual,
        layout: (root as Character).layout,
        modelAssetId: (root as Character).modelAssetId,
        visible: (root as Character).visible,
        peerable: (root as Character).peerable,
        space: (root as Character).space,
        imageAssetId: (root as Character).imageAssetId,
      }
    : ((root as Area).thingFields ?? {});
  const ref = (assetId?: string): MediaReference | undefined => {
    if (!assetId) return;
    const asset = s.assets[assetId];
    return asset?.url
      ? {
          kind: "url",
          url: asset.url,
          type: asset.kind === "model" ? "model" : "image",
        }
      : { kind: "asset", assetId };
  };
  const node = (
    id: string,
    t: Partial<Thing>,
    isRoot = false,
  ): DocumentThing => {
    const v = t.visual;
    const visual = v ? { ...v } : undefined;
    if (visual) {
      delete visual.assetId;
      delete visual.mapAssetId;
    }
    return DocumentThingSchema.parse({
      id,
      name: isRoot ? root.name : t.name,
      description: isRoot ? description : t.description,
      tags: isRoot ? root.tags : t.tags,
      role: t.role ?? "spatial",
      visible: t.visible,
      peerable: t.peerable,
      portable: t.portable,
      value: t.value,
      contentsVisibility: t.contentsVisibility,
      interiorAreaId: t.interiorAreaId,
      character: isRoot && character ? true : undefined,
      space:
        isRoot && scene
          ? {
              drawing: scene.drawing,
              width: scene.width,
              depth: scene.depth,
              zones: scene.zones,
              doors: scene.doors,
              anchors: scene.anchors,
            }
          : t.space
            ? {
                drawing: t.space.drawing,
                width: t.space.width,
                depth: t.space.depth,
                ...(t.layout ?? {
                  zones: [],
                  doors: [],
                  anchors: [
                    { id: "entrance", name: "Entrance", position: [0, 0, 0] },
                  ],
                }),
              }
            : undefined,
      visual,
      media: {
        token: ref(
          isRoot && character
            ? (root as Character).assetId
            : v?.mode === "model"
              ? v.mapAssetId
              : v?.assetId,
        ),
        model: ref(
          t.modelAssetId ?? (v?.mode === "model" ? v.assetId : undefined),
        ),
        artwork: ref(t.imageAssetId),
        background: ref(t.space?.backgroundAssetId),
      },
    });
  };
  const doc: ThingDocument = {
    schemaVersion: 1,
    rootId: root.id,
    nodes: { [root.id]: node(root.id, fields, true) },
    placements: [],
  };
  const walk = (items: Thing[], parentId: string) => {
    for (const t of items) {
      const id = nodeId(root.id, t.id, s);
      doc.nodes[id] = node(id, t);
      doc.placements.push({
        parentId,
        childId: id,
        position: t.position,
        rotation: t.rotation,
        scale: t.scale,
      });
      walk(t.children, id);
    }
  };
  walk(children, root.id);
  return doc;
}
export function legacyIds(
  rootId: string,
  things: Thing[],
  state?: WorldState,
): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (ts: Thing[]) => {
    for (const t of ts) {
      map.set(nodeId(rootId, t.id, state), t.id);
      walk(t.children);
    }
  };
  walk(things);
  return map;
}
export function documentChildren(
  doc: ThingDocument,
  parentId: string,
  ids: Map<string, string>,
  media: (ref?: MediaReference) => string | undefined,
): Thing[] {
  return doc.placements
    .filter((p) => p.parentId === parentId)
    .map((p) => {
      const n = doc.nodes[p.childId];
      const visual: Thing["visual"] = n.visual
        ? { ...n.visual }
        : n.media.token || n.media.model
          ? {
              mode: n.media.model ? ("model" as const) : ("token" as const),
              width: 1.5,
              height: 1.5,
              anchor: [0.5, 0.5] as [number, number],
              footprint: [1, 1] as [number, number],
            }
          : undefined;
      if (visual) {
        visual.assetId = media(
          visual.mode === "model" ? n.media.model : n.media.token,
        );
        if (visual.mode === "model") visual.mapAssetId = media(n.media.token);
      }
      return {
        id: ids.get(n.id) ?? n.id,
        name: n.name,
        description: n.description,
        tags: n.tags,
        role: n.role,
        visible: n.visible,
        peerable: n.peerable,
        portable: n.portable,
        value: n.value,
        contentsVisibility: n.contentsVisibility,
        interiorAreaId: n.interiorAreaId,
        visual,
        modelAssetId: media(n.media.model),
        imageAssetId: media(n.media.artwork),
        space: n.space
          ? {
              drawing: n.space.drawing,
              width: n.space.width,
              depth: n.space.depth,
              backgroundAssetId: media(n.media.background),
            }
          : undefined,
        layout: n.space
          ? {
              zones: n.space.zones,
              doors: n.space.doors,
              anchors: n.space.anchors,
            }
          : undefined,
        position: p.position,
        rotation: p.rotation,
        scale: p.scale,
        children: documentChildren(doc, n.id, ids, media),
      };
    });
}
