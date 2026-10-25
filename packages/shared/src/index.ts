import { z } from "zod";

export const Id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_-]+$/);
const text = z.string().trim().min(1).max(120);
export const TagsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(32)
      .transform((value) => value.toLowerCase()),
  )
  .max(20)
  .transform((tags) => [...new Set(tags)]);
export const Vec3 = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export type Vec3 = z.infer<typeof Vec3>;
export const Visual = z
  .object({
    mode: z.enum(["token", "card", "billboard", "map", "model"]),
    assetId: Id.optional(),
    mapAssetId: Id.optional(),
    width: z.number().positive().max(200).default(1),
    height: z.number().positive().max(200).default(1),
    anchor: z
      .tuple([z.number().min(0).max(1), z.number().min(0).max(1)])
      .default([0.5, 0.5]),
    footprint: z
      .tuple([z.number().positive().max(200), z.number().positive().max(200)])
      .default([1, 1]),
  })
  .strict();
export type Visual = z.infer<typeof Visual>;
/** Drawing is independent of map dimensions: 20 km across in local meters. */
export const DRAWING_LIMIT = 10000;
export const DrawingPointSchema = z.tuple([
  z.number().finite().min(-DRAWING_LIMIT).max(DRAWING_LIMIT),
  z.number().finite().min(-DRAWING_LIMIT).max(DRAWING_LIMIT),
]);
export const StrokeSchema = z
  .object({
    id: Id,
    authorId: Id,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    width: z.number().finite().min(0.01).max(2),
    points: z.array(DrawingPointSchema).min(1).max(512),
  })
  .strict();
export type DrawingStroke = z.infer<typeof StrokeSchema>;
export const DrawingSchema = z
  .object({ version: z.literal(1), strokes: z.array(StrokeSchema).max(300) })
  .strict()
  .superRefine((d, c) => {
    if (new Set(d.strokes.map((s) => s.id)).size !== d.strokes.length)
      c.addIssue({ code: "custom", message: "Duplicate stroke IDs" });
    if (d.strokes.reduce((n, s) => n + s.points.length, 0) > 30000)
      c.addIssue({ code: "custom", message: "Drawing point limit exceeded" });
  });
export type Drawing = z.infer<typeof DrawingSchema>;
export interface DrawingBoard {
  revision: number;
  enabled: boolean;
  drawing: Drawing;
  saved: Drawing;
  history: {
    actorId: string;
    before: DrawingStroke[];
    after: DrawingStroke[];
    undone?: boolean;
  }[];
}
export interface DrawingView {
  id: string;
  revision: number;
  enabled: boolean;
  drawing: Drawing;
  dirty: boolean;
  owner: boolean;
  canUndo: boolean;
  canRedo: boolean;
  source?: { rootId: string; nodeId: string };
}
export const SpaceSchema = z
  .object({
    width: z.number().positive().max(200),
    depth: z.number().positive().max(200),
    backgroundAssetId: Id.optional(),
    drawing: DrawingSchema.optional(),
  })
  .strict();
export type Space = z.infer<typeof SpaceSchema>;
export const ViewTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("location") }).strict(),
  z
    .object({
      kind: z.literal("interior"),
      root: z.enum(["area", "character"]),
      rootId: Id,
      path: z.array(Id).max(12),
    })
    .strict(),
]);
export const DrawingCommandSchema = z
  .object({
    type: z.literal("drawing"),
    operationId: Id,
    sessionId: Id,
    characterId: Id,
    boardId: z.string().max(1000),
    viewTarget: ViewTargetSchema,
    action: z.enum(["stroke", "erase", "undo", "redo", "enable", "clear"]),
    stroke: StrokeSchema.optional(),
    strokeId: Id.optional(),
    enabled: z.boolean().optional(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type ViewTarget = z.infer<typeof ViewTargetSchema>;
export interface ViewedSpace {
  drawing?: DrawingView;
  target: ViewTarget;
  name: string;
  scene: AreaScene;
  breadcrumbs: { name: string; target: ViewTarget }[];
  controllableIds: string[];
  peerableIds: string[];
  ownedIds: string[];
  ownerId: string;
  canArrange: boolean;
  backgroundAssetId?: string;
}
export interface Thing {
  tags?: string[];
  /** Runtime instance origin; authored scene inputs cannot set this. */
  templateId?: string;
  /** Server-owned source document for a runtime instance. */
  templateRootId?: string;
  /** Server-owned runtime ownership; rejected in authored scene JSON. */
  ownerId?: string;
  id: string;
  name: string;
  description: string;
  role: "spatial" | "inventory" | "attribute" | "structure";
  position: Vec3;
  rotation: [number, number, number, number];
  scale: Vec3;
  visible?: boolean;
  peerable?: boolean;
  space?: Space;
  layout?: { zones: Zone[]; doors: Endpoint[]; anchors: Endpoint[] };
  visual?: Visual;
  imageAssetId?: string;
  modelAssetId?: string;
  interiorAreaId?: string;
  portable?: boolean;
  contentsVisibility?: "public" | "controllers";
  value?: string | number | boolean | null;
  children: Thing[];
}
export const ThingSchema: z.ZodType<Thing, z.ZodTypeDef, unknown> = z.lazy(() =>
  z
    .object({
      id: Id,
      name: text,
      tags: TagsSchema.optional(),
      description: z.string().max(10000).default(""),
      role: z
        .enum(["spatial", "inventory", "attribute", "structure"])
        .default("spatial"),
      position: Vec3.default([0, 0, 0]),
      rotation: z
        .tuple([z.number(), z.number(), z.number(), z.number()])
        .refine(
          (q) =>
            q.every(Number.isFinite) && Math.abs(Math.hypot(...q) - 1) < 0.001,
          "Rotation must be a unit quaternion",
        )
        .default([0, 0, 0, 1]),
      scale: Vec3.refine(
        (v) => v.every((n) => n > 0 && n <= 100),
        "Invalid scale",
      ).default([1, 1, 1]),
      visible: z.boolean().optional(),
      peerable: z.boolean().optional(),
      space: SpaceSchema.optional(),
      layout: z
        .object({
          zones: z.array(Zone).max(100),
          doors: z.array(Endpoint).max(100),
          anchors: z.array(Endpoint).min(1).max(100),
        })
        .strict()
        .optional(),
      visual: Visual.optional(),
      imageAssetId: Id.optional(),
      modelAssetId: Id.optional(),
      interiorAreaId: Id.optional(),
      portable: z.boolean().optional(),
      contentsVisibility: z.enum(["public", "controllers"]).optional(),
      value: z
        .union([
          z.string().max(1000),
          z.number().finite(),
          z.boolean(),
          z.null(),
        ])
        .optional(),
      children: z.array(ThingSchema).max(200).default([]),
    })
    .strict(),
);
export const Zone = z
  .object({
    id: Id,
    name: text,
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive().max(200),
    depth: z.number().positive().max(200),
    priority: z.number().int().min(-100).max(100).default(0),
  })
  .strict();
export type Zone = z.infer<typeof Zone>;
export const Endpoint = z
  .object({ id: Id, name: text, position: Vec3 })
  .strict();
export type Endpoint = z.infer<typeof Endpoint>;
export const AreaSceneSchema = z
  .object({
    drawing: DrawingSchema.optional(),
    schemaVersion: z.literal(2),
    revision: z.number().int().nonnegative(),
    width: z.number().positive().max(200),
    depth: z.number().positive().max(200),
    things: z.array(ThingSchema).max(200),
    zones: z.array(Zone).max(100),
    doors: z.array(Endpoint).max(100),
    anchors: z.array(Endpoint).min(1).max(100),
  })
  .strict()
  .superRefine((s, ctx) => {
    const ids = new Set<string>();
    let count = 0;
    const add = (id: string) => {
      if (ids.has(id))
        ctx.addIssue({ code: "custom", message: `Duplicate scene ID: ${id}` });
      ids.add(id);
    };
    const inside = (p: Vec3) =>
      Math.abs(p[0]) <= s.width / 2 &&
      Math.abs(p[1]) <= s.depth / 2 &&
      Math.abs(p[2]) <= 200;
    const walk = (t: Thing, depth: number) => {
      add(t.id);
      if (++count > 500 || depth > 12) {
        ctx.addIssue({
          code: "custom",
          message: "Scene nesting or size limit exceeded",
        });
        return;
      }
      t.children.forEach((c) => walk(c, depth + 1));
    };
    s.things.forEach((t) => {
      walk(t, 0);
      if (t.role === "spatial" && !inside(t.position))
        ctx.addIssue({ code: "custom", message: "Thing outside area bounds" });
    });
    [...s.doors, ...s.anchors].forEach((e) => {
      add(e.id);
      if (!inside(e.position))
        ctx.addIssue({
          code: "custom",
          message: "Endpoint outside area bounds",
        });
    });
    s.zones.forEach((zone) => {
      add(zone.id);
      if (
        Math.abs(zone.x) + zone.width / 2 > s.width / 2 ||
        Math.abs(zone.y) + zone.depth / 2 > s.depth / 2
      )
        ctx.addIssue({ code: "custom", message: "Zone outside area bounds" });
    });
  });
export type AreaScene = z.infer<typeof AreaSceneSchema>;
export const emptyScene = (): AreaScene => ({
  schemaVersion: 2,
  revision: 0,
  width: 20,
  depth: 16,
  things: [],
  zones: [],
  doors: [],
  anchors: [{ id: "entrance", name: "Entrance", position: [0, -5, 0] }],
});
export function flattenThings(things: Thing[]): Thing[] {
  return things.flatMap((t) => [t, ...flattenThings(t.children)]);
}
export function zoneAt(scene: AreaScene, position: Vec3): string {
  return (
    [...scene.zones]
      .filter(
        (z) =>
          Math.abs(position[0] - z.x) <= z.width / 2 &&
          Math.abs(position[1] - z.y) <= z.depth / 2,
      )
      .sort(
        (a, b) =>
          b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )[0]?.id ?? "common"
  );
}
export interface Account {
  id: string;
  issuer: string;
  subject: string;
  email: string;
  name: string;
  wikiUserId?: number;
  wikiGroupId?: number;
}
export interface Area {
  thingFields?: Partial<Thing>;
  authoringPreset?: "place" | "item" | "container";
  tags?: string[];
  id: string;
  name: string;
  ownerId: string;
  collaborators: string[];
  sharedWith: string[];
  articleId: number;
  scenePageId: number;
  sceneRevision: number;
  sceneHash: string;
  latestPublicationId?: string;
  createdAt: string;
}
export interface AreaPublication {
  thingFields?: Partial<Thing>;
  tags?: string[];
  id: string;
  areaId: string;
  name: string;
  article: string;
  scene: AreaScene;
  articleHash: string;
  sceneHash: string;
  articlePageId: number;
  scenePageId: number;
  publishedBy: string;
  createdAt: string;
}
export interface ConnectionInvitation {
  kind?: "request" | "link";
  createdAreaId?: string;
  id: string;
  sourceAreaId: string;
  doorId: string;
  inviterId: string;
  recipientId: string;
  status: "requested" | "pending" | "proposed" | "accepted" | "declined";
  sourceRevision: number;
  sourceEndpointHash: string;
  targetAreaId?: string;
  anchorId?: string;
  targetRevision?: number;
  targetEndpointHash?: string;
}
export interface Connection {
  id: string;
  sourceAreaId: string;
  doorId: string;
  targetAreaId: string;
  anchorId: string;
  sourceEndpointHash: string;
  targetEndpointHash: string;
  enabled: boolean;
}
export interface Character {
  thingFields?: Partial<Thing>;
  layout?: { zones: Zone[]; doors: Endpoint[]; anchors: Endpoint[] };
  modelAssetId?: string;
  visual?: Visual;
  tags?: string[];
  visible?: boolean;
  peerable?: boolean;
  space?: Space;
  description?: string;
  imageAssetId?: string;
  children?: Thing[];
  id: string;
  ownerId: string;
  name: string;
  assetId?: string;
}
export interface Placement {
  interiorTrail?: { areaId: string; position: Vec3; zoneId: string }[];
  id: string;
  characterId: string;
  sessionId: string;
  areaId: string;
  parentId: string;
  position: Vec3;
  zoneId: string;
  revision: number;
}
export interface PlaySession {
  drawings?: Record<string, DrawingBoard>;
  characterFlags?: Record<string, { visible: boolean; peerable: boolean }>;
  characterSpaces?: Record<string, Space>;
  viewFormat?: number;
  liveRevision?: number;
  liveThings?: Record<string, Thing[]>;
  inventories?: Record<string, Thing[]>;
  controllers?: Record<string, string[]>;
  id: string;
  name: string;
  hostId: string;
  memberIds: string[];
  allowedAreaIds: string[];
  pins: Record<string, string>;
  createdAt: string;
}
export interface ChatMessage {
  id: string;
  sessionId: string;
  actorId: string;
  characterId?: string;
  displayName: string;
  channel: "ooc" | "speech";
  areaId?: string;
  text: string;
  createdAt: string;
}
export interface Asset {
  url?: string;
  kind?: "image" | "model";
  id: string;
  ownerId: string;
  key: string;
  mime: string;
  width: number;
  height: number;
}
export interface LoginSession {
  id: string;
  accountId: string;
  expiresAt: number;
}
export interface AuthAttempt {
  returnTo?: string;
  id: string;
  verifier: string;
  nonce: string;
  expiresAt: number;
}
export interface OutboxEvent {
  id: string;
  sessionId: string;
  type: string;
  createdAt: string;
  deliveredAt?: string;
}
export interface Operation {
  id: string;
  actorId: string;
  fingerprint: string;
  result: unknown;
  createdAt: string;
}
export interface WorldState {
  thingIds: Record<string, { id: string; rootId: string; legacyId: string }>;
  accounts: Record<string, Account>;
  areas: Record<string, Area>;
  publications: Record<string, AreaPublication>;
  invitations: Record<string, ConnectionInvitation>;
  connections: Record<string, Connection>;
  characters: Record<string, Character>;
  placements: Record<string, Placement>;
  sessions: Record<string, PlaySession>;
  messages: Record<string, ChatMessage>;
  assets: Record<string, Asset>;
  logins: Record<string, LoginSession>;
  authAttempts: Record<string, AuthAttempt>;
  outbox: Record<string, OutboxEvent>;
  operations: Record<string, Operation>;
}
export const collections = [
  "thingIds",
  "accounts",
  "areas",
  "publications",
  "invitations",
  "connections",
  "characters",
  "placements",
  "sessions",
  "messages",
  "assets",
  "logins",
  "authAttempts",
  "outbox",
  "operations",
] as const;
export function emptyState(): WorldState {
  return Object.fromEntries(
    collections.map((k) => [k, {}]),
  ) as unknown as WorldState;
}
export interface PlaySnapshot {
  view: ViewedSpace;
  session: PlaySession;
  publication: AreaPublication;
  character: Character;
  placement: Placement;
  occupants: { character: Character; placement: Placement }[];
  messages: ChatMessage[];
  scene: AreaScene;
  inventory: Thing[];
  controllableIds: string[];
  peerableIds: string[];
  inventories: Record<string, Thing[]>;
  exits: {
    doorId: string;
    connectionId: string;
    name: string;
    targetAreaId: string;
    destinationName: string;
  }[];
}
export const CommandSchema = z.discriminatedUnion("type", [
  DrawingCommandSchema,
  z.object({
    type: z.literal("interact"),
    operationId: Id,
    sessionId: Id,
    characterId: Id,
    revision: z.number().int().nonnegative(),
    action: z.enum([
      "move",
      "take",
      "drop",
      "enter",
      "exit",
      "control",
      "flags",
    ]),
    viewTarget: ViewTargetSchema.optional(),
    visible: z.boolean().optional(),
    peerable: z.boolean().optional(),
    targetId: Id,
    position: Vec3.optional(),
    recipientId: Id.optional(),
  }),
  z.object({
    type: z.literal("move"),
    operationId: Id,
    sessionId: Id,
    characterId: Id,
    revision: z.number().int().nonnegative(),
    position: Vec3,
  }),
  z.object({
    type: z.literal("travel"),
    operationId: Id,
    sessionId: Id,
    characterId: Id,
    revision: z.number().int().nonnegative(),
    connectionId: Id,
  }),
  z.object({
    type: z.literal("chat"),
    operationId: Id,
    sessionId: Id,
    characterId: Id,
    channel: z.enum(["ooc", "speech"]),
    text: z.string().trim().min(1).max(2000),
  }),
]);
export type Command = z.infer<typeof CommandSchema>;

export {
  yUpToZUp,
  rotateLegacyQuaternion,
  migrateSceneToZUp,
} from "./coordinates.js";

// Versioned authoring contract. Live instances and permissions remain separate.
export const MediaReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("asset"), assetId: Id }).strict(),
  z
    .object({
      kind: z.literal("embedded"),
      mediaId: Id,
      type: z.enum(["image", "model"]),
      mimeType: z.enum([
        "image/png",
        "image/jpeg",
        "image/webp",
        "model/gltf-binary",
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("url"),
      url: z
        .string()
        .url()
        .max(2048)
        .refine((value) => {
          try {
            const u = new URL(value);
            return u.protocol === "https:" && !u.username && !u.password;
          } catch {
            return false;
          }
        }, "Use an HTTPS URL without credentials"),
      type: z.enum(["image", "model"]),
    })
    .strict(),
]);
export type MediaReference = z.infer<typeof MediaReferenceSchema>;
export const DocumentThingSchema = z
  .object({
    id: Id,
    name: text,
    description: z.string().max(100000).default(""),
    tags: TagsSchema.optional(),
    role: z
      .enum(["spatial", "inventory", "attribute", "structure"])
      .default("spatial"),
    visible: z.boolean().optional(),
    peerable: z.boolean().optional(),
    portable: z.boolean().optional(),
    value: z
      .union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()])
      .optional(),
    character: z.literal(true).optional(),
    space: z
      .object({
        drawing: DrawingSchema.optional(),
        width: z.number().positive().max(200),
        depth: z.number().positive().max(200),
        zones: z.array(Zone).max(100).default([]),
        doors: z.array(Endpoint).max(100).default([]),
        anchors: z
          .array(Endpoint)
          .min(1)
          .max(100)
          .default([{ id: "entrance", name: "Entrance", position: [0, 0, 0] }]),
      })
      .strict()
      .optional(),
    visual: Visual.omit({ assetId: true, mapAssetId: true }).optional(),
    interiorAreaId: Id.optional(),
    contentsVisibility: z.enum(["public", "controllers"]).optional(),
    media: z
      .object({
        token: MediaReferenceSchema.optional(),
        artwork: MediaReferenceSchema.optional(),
        background: MediaReferenceSchema.optional(),
        model: MediaReferenceSchema.optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export type DocumentThing = z.infer<typeof DocumentThingSchema>;
export const ThingDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    rootId: Id,
    nodes: z.record(DocumentThingSchema),
    placements: z
      .array(
        z
          .object({
            parentId: Id,
            childId: Id,
            position: Vec3,
            rotation: z
              .tuple([z.number(), z.number(), z.number(), z.number()])
              .refine(
                (q) =>
                  q.every(Number.isFinite) &&
                  Math.abs(Math.hypot(...q) - 1) < 0.001,
                "Use a unit quaternion",
              ),
            scale: Vec3.refine(
              (v) => v.every((n) => n > 0 && n <= 100),
              "Invalid scale",
            ),
          })
          .strict(),
      )
      .max(500),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (!doc.nodes[doc.rootId] || Object.keys(doc.nodes).length > 501)
      fail("Missing root or too many Things");
    const parents = new Map<string, string>();
    for (const [key, node] of Object.entries(doc.nodes))
      if (key !== node.id) fail("Thing identity mismatch");
    for (const p of doc.placements) {
      if (
        !doc.nodes[p.parentId] ||
        !doc.nodes[p.childId] ||
        p.childId === doc.rootId ||
        parents.has(p.childId)
      )
        fail("Invalid containment");
      parents.set(p.childId, p.parentId);
      if (p.position.some((v) => Math.abs(v) > 200))
        fail("Position exceeds limits");
    }
    for (const id of Object.keys(doc.nodes)) {
      const seen = new Set<string>();
      let current = id;
      while (current !== doc.rootId) {
        if (seen.has(current) || seen.size > 12 || !parents.has(current)) {
          fail(
            "Containment must be a connected acyclic tree, at most 12 levels deep",
          );
          break;
        }
        seen.add(current);
        current = parents.get(current)!;
      }
    }
  });
export type ThingDocument = z.infer<typeof ThingDocumentSchema>;
export interface ThingDraft {
  unconnectedDoorIds?: string[];
  document: ThingDocument;
  revision: string;
  canEdit: boolean;
  canPublish: boolean;
  ownerId: string;
  sourceKind: "area" | "character";
  articleUrl?: string;
}

export { validateGlb } from "./glb.js";
export {
  PORTABLE_THING_MAX_BYTES,
  exportThingGlb,
  importThingGlb,
  extractThingSubtree,
  insertThingDocument,
  zUpToGltf,
  gltfToZUp,
  zUpQuaternionToGltf,
  gltfQuaternionToZUp,
  type PortableMedia,
  type PortableThingImport,
} from "./portable-glb.js";
export { drawingSvg } from "./drawing-svg.js";
