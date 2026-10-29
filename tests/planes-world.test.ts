import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { importThingGlb } from "@wikitop/thing-format";

const load = async (id: string) => {
  const bytes = await readFile(`world/planes/${id}.glb`);
  return (
    await importThingGlb(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      `${id}.glb`,
    )
  ).document;
};

describe("public planar system", () => {
  it("links the top-level cosmology without media", async () => {
    const root = await load("planar-system"),
      targets = root.thing.page.placements.map((p) => p.targetId);
    expect(targets).toEqual(
      expect.arrayContaining([
        "plane-material",
        "plane-feywild",
        "plane-shadowfell",
        "planes-inner",
        "planes-outer",
        "plane-astral",
        "plane-ethereal",
      ]),
    );
    expect(Object.keys(root.thing.face.media)).toHaveLength(0);
  });
  it("contains the elemental and energy planes", async () => {
    const inner = await load("planes-inner"),
      targets = inner.thing.page.placements.map((p) => p.targetId);
    expect(targets).toEqual(
      expect.arrayContaining([
        "plane-air",
        "plane-earth",
        "plane-fire",
        "plane-water",
        "plane-positive",
        "plane-negative",
        "plane-elemental-chaos",
      ]),
    );
  });
  it("contains sixteen outer planes and all nine Hells", async () => {
    const outer = await load("planes-outer"),
      hells = await load("plane-nine-hells");
    expect(
      new Set(outer.thing.page.placements.map((p) => p.targetId)).size,
    ).toBe(16);
    expect(hells.thing.page.placements.map((p) => p.targetId)).toEqual([
      "hell-avernus",
      "hell-dis",
      "hell-minauros",
      "hell-phlegethos",
      "hell-stygia",
      "hell-malbolge",
      "hell-maladomini",
      "hell-cania",
      "hell-nessus",
    ]);
  });
});
