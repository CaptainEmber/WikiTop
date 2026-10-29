import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  exportThingGlb,
  gltfQuaternionToZUp,
  gltfToZUp,
  importThingGlb,
  splitLegacyThing,
  ThingDocumentSchema,
  validateGlb,
  zUpQuaternionToGltf,
  zUpToGltf,
  type EmbeddedMedia,
  type ThingDocument,
} from "@wikitop/thing-format";
const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const fixture = (): ThingDocument =>
  ThingDocumentSchema.parse({
    schemaVersion: 2,
    thing: {
      id: "room",
      name: "Portable room",
      description: "A complete Thing.",
      kind: "place",
      tags: ["setting"],
      face: {
        media: {
          token: {
            kind: "embedded",
            mediaId: "picture",
            type: "image",
            mimeType: "image/png",
          },
        },
        visual: {
          mode: "token",
          width: 1,
          height: 1,
          anchor: [0.5, 0.5],
          footprint: [1, 1],
        },
      },
      statBlock: {
        version: 1,
        system: "Test",
        source: "Fixture",
        fields: [{ id: "ac", label: "Armor Class", value: 12 }],
        resources: [{ id: "hp", label: "Hit Points", value: 7, max: 7 }],
        sections: [
          {
            id: "actions",
            name: "Actions",
            entries: [{ id: "poke", name: "Poke", text: "A test action." }],
          },
        ],
      },
      page: {
        width: 12,
        depth: 9,
        background: {
          kind: "embedded",
          mediaId: "picture",
          type: "image",
          mimeType: "image/png",
        },
        zones: [
          {
            id: "desk",
            name: "Desk",
            x: -2,
            y: -1,
            width: 4,
            depth: 2,
            priority: 1,
          },
        ],
        doors: [],
        anchors: [{ id: "entrance", name: "Entrance", position: [0, -3, 0] }],
        drawing: {
          version: 1,
          strokes: [
            {
              id: "stroke",
              authorId: "author",
              color: "#ffcc00",
              width: 0.1,
              points: [
                [0, 0],
                [1, 1],
              ],
            },
          ],
        },
        placements: [
          {
            id: "bag-here",
            targetId: "bag",
            name: "A bag",
            position: [1, 2, 3],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1],
            hidden: true,
          },
        ],
      },
    },
  });
describe("Thing GLB format", () => {
  it("round-trips one Thing and byte-identical media", async () => {
    const media = new Map<string, EmbeddedMedia>([
        ["picture", { id: "picture", mimeType: "image/png", bytes: png }],
      ]),
      glb = await exportThingGlb(fixture(), media);
    expect(() => validateGlb(glb)).not.toThrow();
    const result = await importThingGlb(glb, "room.glb");
    expect(result.document).toEqual(fixture());
    expect([...result.media.get("picture")!.bytes]).toEqual([...png]);
    const size = new DataView(glb).getUint32(12, true),
      json = JSON.parse(
        new TextDecoder().decode(new Uint8Array(glb, 20, size)).trimEnd(),
      );
    expect(json.asset.extras.WikiTop.version).toBe(2);
    expect(json.scenes[0].nodes).toHaveLength(1);
  });
  it("converts Z-up transforms without drift", () => {
    expect(gltfToZUp(zUpToGltf([4, -3, 9]))).toEqual([4, -3, 9]);
    const q: [number, number, number, number] = [
      0,
      0,
      Math.SQRT1_2,
      Math.SQRT1_2,
    ];
    gltfQuaternionToZUp(zUpQuaternionToGltf(q)).forEach((v, i) =>
      expect(v).toBeCloseTo(q[i], 10),
    );
  });
  it("imports an ordinary GLB as one model Thing", async () => {
    const model = await readFile("app/public/assets/sample.glb"),
      r = await importThingGlb(
        model.buffer.slice(
          model.byteOffset,
          model.byteOffset + model.byteLength,
        ),
        "Lantern.glb",
      );
    expect(r.generic).toBe(true);
    expect(r.document.thing.name).toBe("Lantern");
    expect(r.document.thing.face.media.model?.kind).toBe("embedded");
  });
  it("splits a legacy containment tree into linked documents", () => {
    const docs = splitLegacyThing({
      schemaVersion: 1,
      rootId: "room",
      nodes: {
        room: {
          id: "room",
          name: "Room",
          description: "",
          role: "spatial",
          media: {},
          space: {
            width: 10,
            depth: 10,
            zones: [],
            doors: [],
            anchors: [
              { id: "entrance", name: "Entrance", position: [0, 0, 0] },
            ],
          },
        },
        bag: {
          id: "bag",
          name: "Bag",
          description: "",
          role: "inventory",
          media: {},
        },
      },
      placements: [
        {
          parentId: "room",
          childId: "bag",
          position: [1, 2, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
      ],
    });
    expect(docs).toHaveLength(2);
    expect(
      docs.find((d) => d.thing.id === "room")!.thing.page.placements[0]
        .targetId,
    ).toBe("bag");
  });
  it("rejects a damaged embedded payload", async () => {
    const glb = await exportThingGlb(
        fixture(),
        new Map([
          ["picture", { id: "picture", mimeType: "image/png", bytes: png }],
        ]),
      ),
      broken = glb.slice(0),
      view = new DataView(broken),
      jsonSize = view.getUint32(12, true),
      json = JSON.parse(
        new TextDecoder()
          .decode(new Uint8Array(broken, 20, jsonSize))
          .trimEnd(),
      ),
      item = json.asset.extras.WikiTop.media[0],
      start = 20 + jsonSize + 8 + json.bufferViews[item.bufferView].byteOffset;
    new Uint8Array(broken)[start + 8] ^= 1;
    await expect(importThingGlb(broken)).rejects.toThrow();
  });
  it("allows repeated targets with independent hidden placements", () => {
    const d = fixture();
    d.thing.page.placements.push({
      ...d.thing.page.placements[0],
      id: "another-bag",
      position: [4, 5, 0],
      hidden: false,
    });
    const parsed = ThingDocumentSchema.parse(d);
    expect(parsed.thing.page.placements).toHaveLength(2);
    expect(
      parsed.thing.page.placements.every((p) => p.targetId === "bag"),
    ).toBe(true);
  });
});
