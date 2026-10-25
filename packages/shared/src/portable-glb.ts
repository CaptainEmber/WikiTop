import { ThingDocumentSchema, type MediaReference, type ThingDocument } from "./index.js";
import { validateGlb } from "./glb.js";

export const PORTABLE_THING_MAX_BYTES = 100 * 1024 * 1024;
const JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942, MAGIC = 0x46546c67;
export interface PortableMedia {
  id: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "model/gltf-binary";
  bytes: Uint8Array;
}
export interface PortableThingImport {
  document: ThingDocument;
  media: Map<string, PortableMedia>;
  generic: boolean;
}
interface MediaManifest {
  id: string;
  mimeType: PortableMedia["mimeType"];
  byteLength: number;
  sha256: string;
  bufferView: number;
}
interface WikiTopManifest {
  format: "wikitop-thing";
  version: 1;
  document: ThingDocument;
  media: MediaManifest[];
  bindings: Record<string, number>;
}
const pad4 = (n: number) => (n + 3) & ~3;
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, "0")).join("");
async function digest(bytes: Uint8Array) {
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}
function validMime(mime: string, bytes: Uint8Array) {
  if (mime === "image/png") return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/webp") return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  if (mime === "model/gltf-binary") return bytes.length >= 12 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === MAGIC;
  return false;
}
export const zUpToGltf = ([x, y, z]: [number, number, number]) => [x, z, -y] as [number, number, number];
export const gltfToZUp = ([x, y, z]: [number, number, number]) => [x, -z, y] as [number, number, number];
const mulQ = (a: number[], b: number[]) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const c = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], ci = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
export const zUpQuaternionToGltf = (q: [number, number, number, number]) => mulQ(mulQ(c, q), ci) as [number, number, number, number];
export const gltfQuaternionToZUp = (q: [number, number, number, number]) => mulQ(mulQ(ci, q), c) as [number, number, number, number];

function embeddedIds(doc: ThingDocument) {
  const ids = new Set<string>();
  for (const node of Object.values(doc.nodes))
    for (const ref of Object.values(node.media) as (MediaReference | undefined)[])
      if (ref?.kind === "embedded") ids.add(ref.mediaId);
      else if (ref) throw new Error("Export requires every media reference to be embedded");
  return ids;
}
function parseChunks(input: ArrayBuffer) {
  if (input.byteLength < 20 || input.byteLength > PORTABLE_THING_MAX_BYTES) throw new Error("GLB must be between 20 bytes and 100 MiB");
  const view = new DataView(input);
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== input.byteLength) throw new Error("Invalid GLB 2.0 header");
  let offset = 12, json: any, bin = new Uint8Array();
  while (offset < input.byteLength) {
    if (offset + 8 > input.byteLength) throw new Error("Invalid GLB chunk");
    const size = view.getUint32(offset, true), type = view.getUint32(offset + 4, true); offset += 8;
    if (size % 4 || offset + size > input.byteLength) throw new Error("Invalid GLB chunk length");
    if (type === JSON_CHUNK && !json) json = JSON.parse(new TextDecoder().decode(new Uint8Array(input, offset, size)).trimEnd());
    else if (type === BIN_CHUNK && !bin.length) bin = new Uint8Array(input, offset, size);
    else throw new Error("Unsupported GLB chunks");
    offset += size;
  }
  if (!json || json.asset?.version !== "2.0") throw new Error("GLB needs a valid glTF 2.0 JSON chunk");
  return { json, bin };
}

export async function exportThingGlb(docInput: ThingDocument, mediaInput: Map<string, PortableMedia>): Promise<ArrayBuffer> {
  const doc = ThingDocumentSchema.parse(structuredClone(docInput));
  const wanted = embeddedIds(doc), chunks: Uint8Array[] = [], bufferViews: any[] = [], manifestMedia: MediaManifest[] = [];
  let cursor = 0;
  const append = (bytes: Uint8Array, target?: number) => {
    const start = cursor; chunks.push(bytes); cursor += bytes.length;
    const padding = pad4(cursor) - cursor; if (padding) { chunks.push(new Uint8Array(padding)); cursor += padding; }
    const index = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: start, byteLength: bytes.length, ...(target ? { target } : {}) }); return index;
  };
  for (const id of [...wanted].sort()) {
    const item = mediaInput.get(id);
    if (!item) throw new Error(`Missing embedded media ${id}`);
    if (!validMime(item.mimeType, item.bytes)) throw new Error(`Media ${id} does not match ${item.mimeType}`);
    if (item.mimeType === "model/gltf-binary")
      validateGlb(item.bytes.buffer.slice(item.bytes.byteOffset, item.bytes.byteOffset + item.bytes.byteLength));
    const bufferView = append(item.bytes);
    manifestMedia.push({ id, mimeType: item.mimeType, byteLength: item.bytes.length, sha256: await digest(item.bytes), bufferView });
  }
  // A shared marker keeps Things without art visible in ordinary glTF viewers.
  const positions = new Float32Array([0,1,0, -0.7,0,0, 0,0,0.7, 0.7,0,0, 0,0,-0.7, 0,-1,0]);
  const indices = new Uint16Array([0,1,2,0,2,3,0,3,4,0,4,1,5,2,1,5,3,2,5,4,3,5,1,4]);
  const posView = append(new Uint8Array(positions.buffer), 34962), idxView = append(new Uint8Array(indices.buffer), 34963);
  const accessors: any[] = [
    { bufferView: posView, componentType: 5126, count: 6, type: "VEC3", min: [-0.7,-1,-0.7], max: [0.7,1,0.7] },
    { bufferView: idxView, componentType: 5123, count: indices.length, type: "SCALAR", min: [0], max: [5] },
  ], materials: any[] = [{ name: "WikiTop Thing", pbrMetallicRoughness: { baseColorFactor: [0.25,0.68,0.58,1], metallicFactor: 0, roughnessFactor: 0.8 } }],
    meshes: any[] = [{ name: "Thing preview", primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }], images: any[] = [], textures: any[] = [], samplers: any[] = [];
  const planePositions = new Float32Array([-.5,0,-.5, .5,0,-.5, .5,0,.5, -.5,0,.5]), planeUvs = new Float32Array([0,1,1,1,1,0,0,0]), planeIndices = new Uint16Array([0,1,2,0,2,3]);
  const planePos = accessors.push({ bufferView: append(new Uint8Array(planePositions.buffer), 34962), componentType: 5126, count: 4, type: "VEC3", min: [-.5,0,-.5], max: [.5,0,.5] }) - 1;
  const planeUv = accessors.push({ bufferView: append(new Uint8Array(planeUvs.buffer), 34962), componentType: 5126, count: 4, type: "VEC2", min: [0,0], max: [1,1] }) - 1;
  const planeIdx = accessors.push({ bufferView: append(new Uint8Array(planeIndices.buffer), 34963), componentType: 5123, count: 6, type: "SCALAR", min: [0], max: [3] }) - 1;
  const imageMeshes = new Map<string, number>();
  for (const item of manifestMedia) if (item.mimeType === "image/png" || item.mimeType === "image/jpeg") {
    const image = images.push({ bufferView: item.bufferView, mimeType: item.mimeType, name: item.id }) - 1;
    const texture = textures.push({ source: image }) - 1;
    const material = materials.push({ name: item.id, doubleSided: true, alphaMode: "BLEND", pbrMetallicRoughness: { baseColorTexture: { index: texture }, metallicFactor: 0, roughnessFactor: 1 } }) - 1;
    imageMeshes.set(item.id, meshes.push({ name: `${item.id} preview`, primitives: [{ attributes: { POSITION: planePos, TEXCOORD_0: planeUv }, indices: planeIdx, material }] }) - 1);
  }
  const placements = new Map(doc.placements.map((p) => [p.childId, p]));
  const children = new Map<string, string[]>();
  for (const p of doc.placements) children.set(p.parentId, [...(children.get(p.parentId) ?? []), p.childId]);
  const ids = Object.keys(doc.nodes), bindings: Record<string, number> = {};
  const nodes: any[] = ids.map((id, index) => {
    bindings[id] = index;
    const p = placements.get(id), n = doc.nodes[id];
    const preview = n.media.token?.kind === "embedded" ? n.media.token.mediaId : n.media.background?.kind === "embedded" ? n.media.background.mediaId : n.media.artwork?.kind === "embedded" ? n.media.artwork.mediaId : undefined;
    return { name: n.name, extras: { WikiTopThingId: id }, mesh: preview && imageMeshes.has(preview) ? imageMeshes.get(preview) : 0,
      ...(p ? { translation: zUpToGltf(p.position), rotation: zUpQuaternionToGltf(p.rotation), scale: p.scale } : {}),
      ...(children.get(id)?.length ? { children: children.get(id)!.map((child) => ids.indexOf(child)) } : {}) };
  });
  // Merge each static core model into the conventional preview scene. Original
  // GLB bytes stay in their manifest buffer view for exact round trips.
  for (const id of ids) {
    const ref = doc.nodes[id].media.model;
    if (ref?.kind !== "embedded") continue;
    const item = mediaInput.get(ref.mediaId);
    if (!item) continue;
    const source = parseChunks(item.bytes.buffer.slice(item.bytes.byteOffset, item.bytes.byteOffset + item.bytes.byteLength)), g = source.json;
    const viewMap = (g.bufferViews ?? []).map((view: any) => append(source.bin.slice(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength), view.target));
    const accessorMap = (g.accessors ?? []).map((value: any) => accessors.push({ ...value, ...(value.bufferView === undefined ? {} : { bufferView: viewMap[value.bufferView] }) }) - 1);
    const imageMap = (g.images ?? []).map((value: any) => images.push({ ...value, bufferView: viewMap[value.bufferView] }) - 1);
    const samplerMap = (g.samplers ?? []).map((value: any) => samplers.push({ ...value }) - 1);
    const textureMap = (g.textures ?? []).map((value: any) => textures.push({ ...value, ...(value.source === undefined ? {} : { source: imageMap[value.source] }), ...(value.sampler === undefined ? {} : { sampler: samplerMap[value.sampler] }) }) - 1);
    const textureInfo = (value: any) => value ? { ...value, index: textureMap[value.index] } : value;
    const materialMap = (g.materials ?? []).map((value: any) => materials.push({ ...value,
      pbrMetallicRoughness: value.pbrMetallicRoughness ? { ...value.pbrMetallicRoughness, baseColorTexture: textureInfo(value.pbrMetallicRoughness.baseColorTexture), metallicRoughnessTexture: textureInfo(value.pbrMetallicRoughness.metallicRoughnessTexture) } : undefined,
      normalTexture: textureInfo(value.normalTexture), occlusionTexture: textureInfo(value.occlusionTexture), emissiveTexture: textureInfo(value.emissiveTexture) }) - 1);
    const meshMap = (g.meshes ?? []).map((value: any) => meshes.push({ ...value, primitives: value.primitives.map((primitive: any) => ({ ...primitive,
      attributes: Object.fromEntries(Object.entries(primitive.attributes).map(([key, value]) => [key, accessorMap[value as number]])),
      ...(primitive.indices === undefined ? {} : { indices: accessorMap[primitive.indices] }),
      ...(primitive.material === undefined ? {} : { material: materialMap[primitive.material] }),
      ...(primitive.targets ? { targets: primitive.targets.map((target: any) => Object.fromEntries(Object.entries(target).map(([key, value]) => [key, accessorMap[value as number]]))) } : {}) })) }) - 1);
    const nodeStart = nodes.length, sourceNodes = g.nodes ?? [];
    for (let i = 0; i < sourceNodes.length; i++) { const value = sourceNodes[i]; nodes.push({ ...value, ...(value.mesh === undefined ? {} : { mesh: meshMap[value.mesh] }), ...(value.children ? { children: value.children.map((child: number) => nodeStart + child) } : {}) }); }
    const roots = g.scenes?.[g.scene ?? 0]?.nodes?.map((root: number) => nodeStart + root) ?? [];
    nodes[bindings[id]].children = [...(nodes[bindings[id]].children ?? []), ...roots];
  }
  const manifest: WikiTopManifest = { format: "wikitop-thing", version: 1, document: doc, media: manifestMedia, bindings };
  const gltf: any = { asset: { version: "2.0", generator: "WikiTop Portable Thing Editor", extras: { WikiTop: manifest } },
    scene: 0, scenes: [{ name: doc.nodes[doc.rootId].name, nodes: [ids.indexOf(doc.rootId)] }], nodes,
    meshes, materials, accessors, ...(images.length ? { images } : {}), ...(textures.length ? { textures } : {}), ...(samplers.length ? { samplers } : {}), bufferViews, buffers: [{ byteLength: cursor }] };
  const rawJson = new TextEncoder().encode(JSON.stringify(gltf)), jsonLength = pad4(rawJson.length), binLength = cursor;
  const total = 12 + 8 + jsonLength + (binLength ? 8 + binLength : 0);
  if (total > PORTABLE_THING_MAX_BYTES) throw new Error("Portable Thing exceeds 100 MiB");
  const out = new ArrayBuffer(total), v = new DataView(out); v.setUint32(0, MAGIC, true); v.setUint32(4, 2, true); v.setUint32(8, total, true);
  v.setUint32(12, jsonLength, true); v.setUint32(16, JSON_CHUNK, true); const bytes = new Uint8Array(out); bytes.set(rawJson, 20); bytes.fill(0x20, 20 + rawJson.length, 20 + jsonLength);
  if (binLength) { const at = 20 + jsonLength; v.setUint32(at, binLength, true); v.setUint32(at + 4, BIN_CHUNK, true); let write = at + 8; for (const chunk of chunks) { bytes.set(chunk, write); write += chunk.length; } }
  return out;
}

export async function importThingGlb(input: ArrayBuffer, filename = "Imported Thing.glb"): Promise<PortableThingImport> {
  const { json, bin } = parseChunks(input), raw = json.asset?.extras?.WikiTop;
  if (!raw) {
    if (input.byteLength > 10 * 1024 * 1024) throw new Error("A model imported as one Thing must be at most 10 MiB");
    validateGlb(input);
    const id = `thing_${crypto.randomUUID()}`, mediaId = `media_${crypto.randomUUID()}`;
    const document = ThingDocumentSchema.parse({ schemaVersion: 1, rootId: id, nodes: { [id]: { id, name: filename.replace(/\.glb$/i, "") || "Imported Thing", description: "", role: "spatial", visible: true, peerable: true, media: { model: { kind: "embedded", mediaId, type: "model", mimeType: "model/gltf-binary" } }, visual: { mode: "model", width: 1.5, height: 1.5, anchor: [0.5,0.5], footprint: [1,1] } } }, placements: [] });
    return { document, media: new Map([[mediaId, { id: mediaId, mimeType: "model/gltf-binary", bytes: new Uint8Array(input.slice(0)) }]]), generic: true };
  }
  if (raw.format !== "wikitop-thing" || raw.version !== 1) throw new Error("Unsupported WikiTop Thing package version");
  const document = ThingDocumentSchema.parse(raw.document), media = new Map<string, PortableMedia>();
  if (!Array.isArray(raw.media) || raw.media.length > 2048) throw new Error("Invalid portable media manifest");
  for (const item of raw.media as MediaManifest[]) {
    const view = json.bufferViews?.[item.bufferView];
    if (!view || view.buffer !== 0 || !Number.isInteger(view.byteOffset ?? 0) || !Number.isInteger(view.byteLength) || view.byteLength !== item.byteLength) throw new Error(`Invalid buffer view for ${item.id}`);
    const start = view.byteOffset ?? 0, end = start + view.byteLength;
    if (start < 0 || end > bin.length) throw new Error(`Media ${item.id} exceeds the GLB buffer`);
    const bytes = bin.slice(start, end);
    if (!validMime(item.mimeType, bytes) || await digest(bytes) !== item.sha256) throw new Error(`Media ${item.id} failed validation`);
    if (item.mimeType === "model/gltf-binary")
      validateGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (media.has(item.id)) throw new Error(`Duplicate media ${item.id}`);
    media.set(item.id, { id: item.id, mimeType: item.mimeType, bytes });
  }
  for (const id of embeddedIds(document)) if (!media.has(id)) throw new Error(`Missing embedded media ${id}`);
  for (const [id, nodeIndex] of Object.entries(raw.bindings ?? {})) if (!document.nodes[id] || json.nodes?.[nodeIndex as number]?.extras?.WikiTopThingId !== id) throw new Error("Invalid Thing preview binding");
  return { document, media, generic: false };
}

export function extractThingSubtree(doc: ThingDocument, rootId: string): ThingDocument {
  if (!doc.nodes[rootId]) throw new Error("Thing does not exist");
  const ids = new Set([rootId]); let changed = true;
  while (changed) { changed = false; for (const p of doc.placements) if (ids.has(p.parentId) && !ids.has(p.childId)) { ids.add(p.childId); changed = true; } }
  return ThingDocumentSchema.parse({ schemaVersion: 1, rootId, nodes: Object.fromEntries([...ids].map((id) => [id, structuredClone(doc.nodes[id])])), placements: doc.placements.filter((p) => ids.has(p.parentId) && ids.has(p.childId)).map((p) => structuredClone(p)) });
}
export function insertThingDocument(targetInput: ThingDocument, sourceInput: ThingDocument, parentId: string) {
  const target = structuredClone(targetInput), source = structuredClone(sourceInput);
  if (!target.nodes[parentId]) throw new Error("Insert destination does not exist");
  const idMap = new Map<string, string>();
  for (const old of Object.keys(source.nodes)) { let next = old; while (target.nodes[next] || [...idMap.values()].includes(next)) next = `thing_${crypto.randomUUID()}`; idMap.set(old, next); }
  const remapEndpoint = () => `part_${crypto.randomUUID()}`;
  for (const [old, node] of Object.entries(source.nodes)) {
    const id = idMap.get(old)!; node.id = id;
    if (node.space) { for (const endpoint of [...node.space.zones, ...node.space.doors, ...node.space.anchors]) endpoint.id = remapEndpoint(); for (const stroke of node.space.drawing?.strokes ?? []) stroke.id = `stroke_${crypto.randomUUID()}`; }
    target.nodes[id] = node;
  }
  target.placements.push(...source.placements.map((p) => ({ ...p, parentId: idMap.get(p.parentId)!, childId: idMap.get(p.childId)! })));
  target.placements.push({ parentId, childId: idMap.get(source.rootId)!, position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] });
  return { document: ThingDocumentSchema.parse(target), insertedRootId: idMap.get(source.rootId)!, idMap };
}
