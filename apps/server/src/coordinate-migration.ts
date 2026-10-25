import {
  migrateSceneToZUp,
  yUpToZUp,
  type WorldState,
  type AreaScene,
} from "@wikitop/shared";
import { hash } from "./world.js";

export function migrateCoordinateState(
  original: WorldState,
  drafts: Record<string, unknown>,
) {
  const state = structuredClone(original),
    scenes: Record<string, AreaScene> = {},
    endpointHashes = new Map<string, string>(),
    legacyAreas = new Set<string>();
  const convert = (raw: any, areaId: string) => {
    const converted = migrateSceneToZUp(raw);
    if (raw.schemaVersion === 1) {
      legacyAreas.add(areaId);
      for (const key of ["doors", "anchors"] as const)
        raw[key].forEach((e: any, index: number) =>
          endpointHashes.set(hash(e), hash(converted[key][index])),
        );
    }
    return converted;
  };
  for (const area of Object.values(state.areas)) {
    const raw = drafts[area.id];
    if (!raw) throw new Error(`Missing wiki source for ${area.id}`);
    scenes[area.id] = convert(raw, area.id);
    area.sceneHash = hash(scenes[area.id]);
  }
  for (const publication of Object.values(state.publications)) {
    publication.scene = convert(publication.scene, publication.areaId);
    publication.sceneHash = hash(publication.scene);
  }
  for (const placement of Object.values(state.placements))
    if (legacyAreas.has(placement.areaId)) {
      placement.position = yUpToZUp(placement.position);
      placement.revision++;
    }
  for (const connection of Object.values(state.connections)) {
    if (
      !legacyAreas.has(connection.sourceAreaId) &&
      !legacyAreas.has(connection.targetAreaId)
    )
      continue;
    const source = endpointHashes.get(connection.sourceEndpointHash),
      target = endpointHashes.get(connection.targetEndpointHash);
    if (legacyAreas.has(connection.sourceAreaId)) {
      if (source) connection.sourceEndpointHash = source;
      else connection.enabled = false;
    }
    if (legacyAreas.has(connection.targetAreaId)) {
      if (target) connection.targetEndpointHash = target;
      else connection.enabled = false;
    }
  }
  for (const invitation of Object.values(state.invitations)) {
    if (
      !legacyAreas.has(invitation.sourceAreaId) &&
      !legacyAreas.has(invitation.targetAreaId ?? "")
    )
      continue;
    const source = endpointHashes.get(invitation.sourceEndpointHash),
      target = invitation.targetEndpointHash
        ? endpointHashes.get(invitation.targetEndpointHash)
        : undefined;
    if (source) invitation.sourceEndpointHash = source;
    if (target) invitation.targetEndpointHash = target;
    if (
      ["pending", "proposed"].includes(invitation.status) &&
      ((legacyAreas.has(invitation.sourceAreaId) && !source) ||
        (invitation.status === "proposed" &&
          legacyAreas.has(invitation.targetAreaId!) &&
          !target))
    )
      invitation.status = "declined";
  }
  return { state, scenes };
}
