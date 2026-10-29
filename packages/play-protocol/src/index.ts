import { z } from "zod";
import {
  DrawingSchema,
  Id,
  StrokeSchema,
  Vec3Schema,
  VisualSchema,
  type Drawing,
  type DrawingStroke,
  type Vec3,
  type Visual,
} from "@wikitop/thing-format";

export const ROOM_MAX_PARTICIPANTS = 10;
export const ROOM_EMPTY_TTL_MS = 60 * 60 * 1000;
export const THING_CHUNK_BYTES = 256 * 1024;
export const SHARED_GRAPH_MAX_THINGS = 100;
export const SHARED_GRAPH_MAX_BYTES = 100 * 1024 * 1024;

export const CharacterSummarySchema = z
  .object({
    id: Id,
    name: z.string().min(1).max(120),
    description: z.string().max(1000).default(""),
    revision: z.string().max(128),
    visual: VisualSchema.optional(),
    graphIds: z.array(Id).max(SHARED_GRAPH_MAX_THINGS).default([]),
  })
  .strict();
export type CharacterSummary = z.infer<typeof CharacterSummarySchema>;
export const PlayParticipantSchema = z
  .object({
    id: Id,
    name: z.string().min(1).max(60),
    role: z.enum(["host", "player"]),
    connected: z.boolean(),
    joinedAt: z.number().int().nonnegative(),
    character: CharacterSummarySchema,
    reconnectUntil: z.number().int().nonnegative(),
    position: Vec3Schema,
  })
  .strict();
export type PlayParticipant = z.infer<typeof PlayParticipantSchema>;
export const PartyLocationSchema = z
  .object({
    thingId: Id,
    source: z.enum(["published", "host-local"]),
    anchorId: Id.optional(),
  })
  .strict();
export type PartyLocation = z.infer<typeof PartyLocationSchema>;
export const PlayDrawingBoardSchema = z
  .object({
    thingId: Id,
    revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    drawing: DrawingSchema,
  })
  .strict();
export type PlayDrawingBoard = z.infer<typeof PlayDrawingBoardSchema>;
const LiveResourceSchema = z
  .object({
    value: z.number().finite().min(-1000000000).max(1000000000),
    max: z.number().finite().min(0).max(1000000000).optional(),
  })
  .strict();
export const LiveThingInstanceSchema = z
  .object({
    pageId: Id,
    placementId: Id,
    targetId: Id,
    name: z.string().min(1).max(120),
    position: Vec3Schema,
    resources: z.record(Id, LiveResourceSchema).default({}),
    conditions: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    visible: z.boolean().optional(),
  })
  .strict();
export type LiveThingInstance = z.infer<typeof LiveThingInstanceSchema>;
export const WorldRevisionSchema = z
  .object({
    repository: z.string().max(200),
    commit: z.string().max(64),
    rawBase: z.string().url().max(500),
  })
  .strict();
export type WorldRevision = z.infer<typeof WorldRevisionSchema>;
export const PlayRoomSnapshotSchema = z
  .object({
    id: Id,
    revision: z.number().int().nonnegative(),
    hostId: Id,
    worldOwnerId: Id,
    location: PartyLocationSchema,
    world: WorldRevisionSchema,
    participants: z.array(PlayParticipantSchema).max(ROOM_MAX_PARTICIPANTS),
    boards: z.record(PlayDrawingBoardSchema),
    instances: z.record(z.record(LiveThingInstanceSchema)).default({}),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type PlayRoomSnapshot = z.infer<typeof PlayRoomSnapshotSchema>;

const commandBase = {
  operationId: Id,
  revision: z.number().int().nonnegative(),
};
export const PlayCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...commandBase,
      type: z.literal("move"),
      participantId: Id,
      position: Vec3Schema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("travel"),
      thingId: Id,
      source: z.enum(["published", "host-local"]),
      anchorId: Id.optional(),
      arrival: Vec3Schema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("transfer-host"),
      participantId: Id,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("drawing-enable"),
      thingId: Id,
      enabled: z.boolean(),
      boardRevision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("drawing-stroke"),
      thingId: Id,
      stroke: StrokeSchema,
      boardRevision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("drawing-erase"),
      thingId: Id,
      strokeId: Id,
      boardRevision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("drawing-clear"),
      thingId: Id,
      boardRevision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("character-update"),
      character: CharacterSummarySchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("instance-move"),
      instance: LiveThingInstanceSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("instance-update"),
      instance: LiveThingInstanceSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      type: z.literal("instance-reset"),
      pageId: Id,
      placementId: Id,
    })
    .strict(),
  z
    .object({
      type: z.literal("thing-request"),
      requestId: Id,
      ownerId: Id,
      thingId: Id,
    })
    .strict(),
  z
    .object({
      type: z.literal("thing-chunk"),
      requestId: Id,
      targetId: Id,
      thingId: Id,
      index: z.number().int().nonnegative(),
      total: z.number().int().positive().max(4096),
      byteLength: z.number().int().positive().max(SHARED_GRAPH_MAX_BYTES),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      data: z.string().max(THING_CHUNK_BYTES * 2),
    })
    .strict(),
  z
    .object({
      type: z.literal("cursor"),
      thingId: Id,
      position: z.tuple([z.number().finite(), z.number().finite()]),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    })
    .strict(),
]);
export type PlayCommand = z.infer<typeof PlayCommandSchema>;
export const PlayServerMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("welcome"),
      participantId: Id,
      reconnectSecret: z.string().min(32),
      snapshot: PlayRoomSnapshotSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("snapshot"), snapshot: PlayRoomSnapshotSchema })
    .strict(),
  z
    .object({
      type: z.literal("ack"),
      operationId: Id,
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      operationId: Id.optional(),
      code: z.string(),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("thing-request"),
      requestId: Id,
      requesterId: Id,
      thingId: Id,
    })
    .strict(),
  z
    .object({
      type: z.literal("thing-chunk"),
      requestId: Id,
      ownerId: Id,
      thingId: Id,
      index: z.number().int().nonnegative(),
      total: z.number().int().positive(),
      byteLength: z.number().int().positive(),
      sha256: z.string(),
      data: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("cursor"),
      participantId: Id,
      thingId: Id,
      position: z.tuple([z.number(), z.number()]),
      color: z.string(),
    })
    .strict(),
]);
export type PlayServerMessage = z.infer<typeof PlayServerMessageSchema>;
export interface CharacterShareManifest {
  rootId: string;
  revision: string;
  thingIds: string[];
  totalBytes: number;
}
export interface LivePlacement {
  participantId: string;
  thingId: string;
  position: Vec3;
}
export function promoteLongestConnected(snapshot: PlayRoomSnapshot) {
  const next = snapshot.participants
    .filter((p) => p.connected)
    .sort((a, b) => a.joinedAt - b.joinedAt)[0];
  if (!next) return undefined;
  snapshot.participants.forEach(
    (p) => (p.role = p.id === next.id ? "host" : "player"),
  );
  snapshot.hostId = next.id;
  return next.id;
}
export type { Drawing, DrawingStroke, Vec3, Visual };
