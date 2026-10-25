import { z } from "zod";

export const THING_PACKAGE_MAX_BYTES = 25 * 1024 * 1024;
export const Id = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/);
export const Vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export type Vec3 = z.infer<typeof Vec3Schema>;
const QuaternionSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]).refine(
  (q) => q.every(Number.isFinite) && Math.abs(Math.hypot(...q) - 1) < 0.001,
  "Use a unit quaternion",
);
export const TagsSchema = z.array(z.string().trim().min(1).max(32).transform((v) => v.toLowerCase())).max(20).transform((v) => [...new Set(v)]);
export const VisualSchema = z.object({
  mode: z.enum(["token", "card", "billboard", "map", "model"]),
  assetId: z.string().optional(), mapAssetId: z.string().optional(),
  width: z.number().positive().max(200).default(1), height: z.number().positive().max(200).default(1),
  anchor: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).default([0.5, 0.5]),
  footprint: z.tuple([z.number().positive().max(200), z.number().positive().max(200)]).default([1, 1]),
}).strict();
export type Visual = z.infer<typeof VisualSchema>;
export const DRAWING_LIMIT = 10000;
export const DrawingPointSchema = z.tuple([z.number().finite().min(-DRAWING_LIMIT).max(DRAWING_LIMIT), z.number().finite().min(-DRAWING_LIMIT).max(DRAWING_LIMIT)]);
export const StrokeSchema = z.object({ id: Id, authorId: Id, color: z.string().regex(/^#[0-9a-fA-F]{6}$/), width: z.number().finite().min(0.01).max(2), points: z.array(DrawingPointSchema).min(1).max(512) }).strict();
export type DrawingStroke = z.infer<typeof StrokeSchema>;
export const DrawingSchema = z.object({ version: z.literal(1), strokes: z.array(StrokeSchema).max(300) }).strict().superRefine((d, c) => {
  if (new Set(d.strokes.map((s) => s.id)).size !== d.strokes.length) c.addIssue({ code: "custom", message: "Duplicate stroke IDs" });
  if (d.strokes.reduce((n, s) => n + s.points.length, 0) > 30000) c.addIssue({ code: "custom", message: "Drawing point limit exceeded" });
});
export type Drawing = z.infer<typeof DrawingSchema>;
export const MediaReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("embedded"), mediaId: Id, type: z.enum(["image", "model"]), mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "model/gltf-binary"]) }).strict(),
  z.object({ kind: z.literal("url"), url: z.string().url().max(2048).refine((v) => { try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; } }, "Use an HTTPS URL without credentials"), type: z.enum(["image", "model"]) }).strict(),
]);
export type MediaReference = z.infer<typeof MediaReferenceSchema>;
export const MediaSlotsSchema = z.object({ token: MediaReferenceSchema.optional(), artwork: MediaReferenceSchema.optional(), background: MediaReferenceSchema.optional(), model: MediaReferenceSchema.optional() }).strict().default({});
export const ZoneSchema = z.object({ id: Id, name: z.string().trim().min(1).max(120), x: z.number().finite(), y: z.number().finite(), width: z.number().positive().max(20000), depth: z.number().positive().max(20000), priority: z.number().int().min(-100).max(100).default(0) }).strict();
export const EndpointSchema = z.object({ id: Id, name: z.string().trim().min(1).max(120), position: Vec3Schema }).strict();
export const ThingFaceSchema = z.object({ visual: VisualSchema.optional(), media: z.object({ token: MediaReferenceSchema.optional(), artwork: MediaReferenceSchema.optional(), model: MediaReferenceSchema.optional() }).strict().default({}) }).strict();
export const ThingPlacementSchema = z.object({
  id: Id, targetId: Id, name: z.string().trim().min(1).max(120).optional(),
  position: Vec3Schema, rotation: QuaternionSchema, scale: Vec3Schema.refine((v) => v.every((n) => n > 0 && n <= 100), "Invalid scale"),
  face: VisualSchema.optional(),
}).strict();
export type ThingPlacement = z.infer<typeof ThingPlacementSchema>;
export type ThingLink = ThingPlacement;
export const ThingPageSchema = z.object({
  width: z.number().positive().max(20000).default(20), depth: z.number().positive().max(20000).default(16),
  background: MediaReferenceSchema.optional(), drawing: DrawingSchema.optional(), zones: z.array(ZoneSchema).max(100).default([]),
  doors: z.array(EndpointSchema).max(100).default([]), anchors: z.array(EndpointSchema).min(1).max(100).default([{ id: "entrance", name: "Entrance", position: [0, 0, 0] }]),
  placements: z.array(ThingPlacementSchema).max(500).default([]),
}).strict();
export const ThingDefinitionSchema = z.object({
  id: Id, name: z.string().trim().min(1).max(120), description: z.string().max(100000).default(""), tags: TagsSchema.optional(),
  kind: z.enum(["character", "place", "item", "vehicle", "creature", "object", "other"]).default("other"),
  face: ThingFaceSchema.default({ media: {} }), page: ThingPageSchema,
}).strict();
export type ThingDefinition = z.infer<typeof ThingDefinitionSchema>;
export const ThingDocumentSchema = z.object({ schemaVersion: z.literal(2), thing: ThingDefinitionSchema }).strict().superRefine((doc, ctx) => {
  const ids = new Set<string>();
  for (const p of doc.thing.page.placements) {
    if (ids.has(p.id)) ctx.addIssue({ code: "custom", message: `Duplicate placement ${p.id}` });
    ids.add(p.id);
    if (p.position.some((v) => Math.abs(v) > DRAWING_LIMIT)) ctx.addIssue({ code: "custom", message: `Placement ${p.id} exceeds coordinate limits` });
  }
});
export type ThingDocument = z.infer<typeof ThingDocumentSchema>;
export type ThingId = string;
export interface EmbeddedMedia { id: string; mimeType: "image/png" | "image/jpeg" | "image/webp" | "model/gltf-binary"; bytes: Uint8Array }
export type PortableMedia = EmbeddedMedia;
export interface ThingCatalogEntry { id: string; name: string; description: string; tags: string[]; kind: ThingDefinition["kind"]; path: string; sha256: string; byteLength: number; links: string[] }
export interface ThingCatalog { version: 1; generatedAt: string; things: ThingCatalogEntry[] }

export interface Thing { id: string; name: string; description: string; role: "spatial" | "inventory" | "attribute" | "structure"; position: Vec3; rotation: [number, number, number, number]; scale: Vec3; visual?: Visual; value?: string | number | boolean | null; children: Thing[] }
export interface AreaScene { schemaVersion: 2; revision: number; width: number; depth: number; drawing?: Drawing; zones: z.infer<typeof ZoneSchema>[]; doors: z.infer<typeof EndpointSchema>[]; anchors: z.infer<typeof EndpointSchema>[]; things: Thing[] }
export interface PlaySnapshot { occupants: { character: { id: string; name: string; assetId?: string; visual?: Visual }; placement: { areaId: string; position: Vec3 } }[]; character: { id: string }; view: { drawing?: { drawing: Drawing } } }
export const emptyScene = (): AreaScene => ({ schemaVersion: 2, revision: 0, width: 20, depth: 16, zones: [], doors: [], anchors: [{ id: "entrance", name: "Entrance", position: [0, 0, 0] }], things: [] });

export { validateGlb } from "./glb.js";
export { exportThingGlb, importThingGlb, splitLegacyThing, zUpToGltf, gltfToZUp, zUpQuaternionToGltf, gltfQuaternionToZUp, type PortableThingImport } from "./portable-glb.js";
