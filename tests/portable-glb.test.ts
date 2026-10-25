import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  exportThingGlb,
  extractThingSubtree,
  gltfQuaternionToZUp,
  gltfToZUp,
  importThingGlb,
  insertThingDocument,
  ThingDocumentSchema,
  validateGlb,
  zUpQuaternionToGltf,
  zUpToGltf,
  type PortableMedia,
  type ThingDocument,
} from "../packages/shared/src/index";

const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0, 0, 0, 0,
]);
function fixture(): ThingDocument {
  return ThingDocumentSchema.parse({
    schemaVersion: 1,
    rootId: "root",
    nodes: {
      root: {
        id: "root", name: "Portable room", description: "A complete Thing.",
        role: "spatial", visible: true, peerable: true,
        space: {
          width: 12, depth: 9,
          zones: [{ id: "zone", name: "Desk", x: -2, y: -1, width: 4, depth: 2, priority: 1 }],
          doors: [{ id: "door", name: "Elsewhere", position: [5, 0, 0] }],
          anchors: [{ id: "anchor", name: "Entrance", position: [0, -3, 0] }],
          drawing: { version: 1, strokes: [{ id: "stroke", authorId: "author", color: "#ffcc00", width: 0.1, points: [[0, 0], [1, 1]] }] },
        },
        media: { background: { kind: "embedded", mediaId: "picture", type: "image", mimeType: "image/png" } },
      },
      bag: { id: "bag", name: "Bag", description: "", role: "inventory", visible: true, peerable: true, space: { width: 4, depth: 4, zones: [], doors: [], anchors: [{ id: "bag-anchor", name: "Center", position: [0,0,0] }] }, media: {} },
      hp: { id: "hp", name: "HP", description: "", role: "attribute", value: 12, media: {} },
      model: { id: "model", name: "Model", description: "", role: "spatial", media: { model: { kind: "embedded", mediaId: "model-bytes", type: "model", mimeType: "model/gltf-binary" } }, visual: { mode: "model", width: 1, height: 1, anchor: [.5,.5], footprint: [1,1] } },
    },
    placements: [
      { parentId: "root", childId: "bag", position: [1,2,3], rotation: [0,0,0,1], scale: [1,1,1] },
      { parentId: "bag", childId: "hp", position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] },
      { parentId: "root", childId: "model", position: [-2,1,0], rotation: [0,0,0,1], scale: [1,1,1] },
    ],
  });
}
describe("portable Thing GLB", () => {
  it("round-trips the normalized tree and original media bytes", async () => {
    const model = new Uint8Array(await readFile("apps/web/public/assets/sample.glb"));
    const media = new Map<string, PortableMedia>([
      ["picture", { id: "picture", mimeType: "image/png", bytes: png }],
      ["model-bytes", { id: "model-bytes", mimeType: "model/gltf-binary", bytes: model }],
    ]);
    const glb = await exportThingGlb(fixture(), media);
    expect(() => validateGlb(glb)).not.toThrow();
    const result = await importThingGlb(glb, "room.glb");
    expect(result.generic).toBe(false);
    expect(result.document).toEqual(fixture());
    expect([...result.media.get("picture")!.bytes]).toEqual([...png]);
    expect([...result.media.get("model-bytes")!.bytes]).toEqual([...model]);
    const jsonSize = new DataView(glb).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonSize)).trimEnd());
    expect(json.asset.extras.WikiTop.format).toBe("wikitop-thing");
    expect(json.nodes.map((n: any) => n.extras.WikiTopThingId)).toEqual(expect.arrayContaining(["root", "bag", "hp", "model"]));
    expect(json.scenes[0].nodes).toHaveLength(1);
    expect(json.meshes.length).toBeGreaterThan(1);
  });

  it("extracts a subtree and inserts it with collision-safe identities", () => {
    const source = fixture(), subtree = extractThingSubtree(source, "bag");
    expect(Object.keys(subtree.nodes).sort()).toEqual(["bag", "hp"]);
    const result = insertThingDocument(source, subtree, "root");
    expect(result.insertedRootId).not.toBe("bag");
    expect(Object.keys(result.document.nodes)).toHaveLength(6);
    expect(result.document.placements.find((p) => p.childId === result.insertedRootId)?.parentId).toBe("root");
  });

  it("converts Z-up transforms at the glTF boundary without drift", () => {
    expect(gltfToZUp(zUpToGltf([4, -3, 9]))).toEqual([4, -3, 9]);
    const q: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
    const round = gltfQuaternionToZUp(zUpQuaternionToGltf(q));
    round.forEach((value, index) => expect(value).toBeCloseTo(q[index], 10));
  });

  it("imports an ordinary GLB as one model Thing", async () => {
    const model = await readFile("apps/web/public/assets/sample.glb");
    const result = await importThingGlb(model.buffer.slice(model.byteOffset, model.byteOffset + model.byteLength), "Lantern.glb");
    expect(result.generic).toBe(true);
    expect(result.document.nodes[result.document.rootId].name).toBe("Lantern");
    expect(result.document.nodes[result.document.rootId].media.model?.kind).toBe("embedded");
  });

  it("rejects a damaged embedded payload", async () => {
    const glb = await exportThingGlb(fixture(), new Map([
      ["picture", { id: "picture", mimeType: "image/png" as const, bytes: png }],
      ["model-bytes", { id: "model-bytes", mimeType: "model/gltf-binary" as const, bytes: new Uint8Array(await readFile("apps/web/public/assets/sample.glb")) }],
    ]));
    const broken = glb.slice(0), view = new DataView(broken), jsonSize = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(broken, 20, jsonSize)).trimEnd());
    const picture = json.asset.extras.WikiTop.media.find((item: any) => item.id === "picture"), binStart = 20 + jsonSize + 8;
    new Uint8Array(broken)[binStart + json.bufferViews[picture.bufferView].byteOffset + 8] ^= 1;
    await expect(importThingGlb(broken)).rejects.toThrow();
  });
});
