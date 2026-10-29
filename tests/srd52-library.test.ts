import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { importThingGlb } from "@wikitop/thing-format";

const load = async (path: string) => {
  const bytes = await readFile(path);
  return (
    await importThingGlb(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      path,
    )
  ).document;
};

describe("SRD 5.2.1 libraries", () => {
  it("ships complete linked monster and equipment collections", async () => {
    const monsters = await readdir("world/srd-5.2/monsters");
    const equipment = await readdir("world/srd-5.2/equipment");
    expect(monsters.filter((name) => name.endsWith(".glb"))).toHaveLength(328);
    expect(equipment.filter((name) => name.endsWith(".glb"))).toHaveLength(179);

    const monsterLibrary = await load("world/srd-5.2/srd52-monster-library.glb");
    const equipmentLibrary = await load("world/srd-5.2/srd52-equipment-library.glb");
    expect(monsterLibrary.thing.page.placements).toHaveLength(328);
    expect(equipmentLibrary.thing.page.placements).toHaveLength(179);
  });

  it("preserves representative structured rules fields", async () => {
    const guard = await load("world/srd-5.2/monsters/srd52-monster-guard.glb");
    const sword = await load("world/srd-5.2/equipment/srd52-equipment-longsword.glb");
    const airship = await load("world/srd-5.2/equipment/srd52-equipment-airship.glb");
    expect(guard.thing.statBlock?.resources[0]).toMatchObject({ id: "hp", value: 11, max: 11 });
    expect(guard.thing.statBlock?.fields.some((field) => field.label === "Challenge" && String(field.value).startsWith("1/8"))).toBe(true);
    expect(sword.thing.statBlock?.fields.some((field) => field.label === "Damage" && field.value === "1d8 Slashing")).toBe(true);
    expect(airship.thing.statBlock?.fields.some((field) => field.label === "Hit Points" && field.value === "300")).toBe(true);
  });
});
