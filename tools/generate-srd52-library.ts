import { execFileSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  exportThingGlb,
  ThingDocumentSchema,
  type StatBlock,
  type ThingDocument,
  type ThingPlacement,
} from "@wikitop/thing-format";

if (!globalThis.crypto)
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });

const source = process.argv[2] ?? "sources/srd-5.2.1/SRD_CC_v5.2.1.pdf";
const output = process.argv[3] ?? "world/srd-5.2";
const tmp = join("/tmp", `wikitop-srd52-${process.pid}`);
const slug = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
const clean = (value: string) =>
  value
    .replace(/\f/g, "\n")
    .replace(/([A-Za-z])-\n\s*([a-z])/g, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
const field = (id: string, label: string, value: string, group?: string) => ({
  id,
  label,
  value,
  ...(group ? { group } : {}),
});
const page = (placements: ThingPlacement[] = []) => ({
  width: 30,
  depth: 24,
  zones: [],
  doors: [],
  anchors: [{ id: "entrance", name: "Entrance", position: [0, 0, 0] as [number, number, number] }],
  placements,
});
const placement = (targetId: string, index: number): ThingPlacement => ({
  id: `entry-${index + 1}-${slug(targetId)}`.slice(0, 160),
  targetId,
  position: [((index % 8) - 3.5) * 3, (3 - Math.floor(index / 8)) * 2.5, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});
const writeThing = async (folder: string, document: ThingDocument) => {
  await mkdir(join(output, folder), { recursive: true });
  await writeFile(
    join(output, folder, `${document.thing.id}.glb`),
    new Uint8Array(await exportThingGlb(document, new Map())),
  );
};
const baseDocument = (
  id: string,
  name: string,
  kind: "creature" | "item" | "place",
  description: string,
  tags: string[],
  statBlock?: StatBlock,
  placements: ThingPlacement[] = [],
) =>
  ThingDocumentSchema.parse({
    schemaVersion: 2,
    thing: {
      id,
      name,
      description,
      kind,
      tags,
      face: { media: {} },
      ...(statBlock ? { statBlock } : {}),
      page: page(placements),
    },
  });

await mkdir(tmp, { recursive: true });
const extract = (first: number, last: number, file: string, crop?: [number, number]) => {
  const args = ["-f", String(first), "-l", String(last), "-layout"];
  if (crop) args.push("-x", String(crop[0]), "-y", "0", "-W", String(crop[1]), "-H", "783");
  args.push(source, file);
  execFileSync("pdftotext", args);
};

// Stat blocks occupy two independent columns. Reading each page left-to-right
// prevents pdftotext from interleaving unrelated creatures.
let monsterText = "";
for (let pageNumber = 259; pageNumber <= 364; pageNumber++) {
  for (const [side, crop] of [["l", [0, 297]], ["r", [297, 297]]] as const) {
    const file = join(tmp, `monster-${pageNumber}-${side}.txt`);
    extract(pageNumber, pageNumber, file, crop as [number, number]);
    monsterText += `\n${await readFile(file, "utf8")}`;
  }
}
monsterText = monsterText
  .replace(/^\s*\d+\s+System Reference Document 5\.2\.1\s*$/gm, "")
  .replace(/^\s*System Reference Document 5\.2\.1\s+\d+\s*$/gm, "");

const creatureType = "(?:Aberration|Beast|Celestial|Construct|Dragon|Elemental|Fey|Fiend|Giant|Humanoid|Monstrosity|Ooze|Plant|Undead|Swarm(?: of [^,]+)?)";
const header = new RegExp(
  `^\\s*([A-Z][A-Za-z’' -]{1,70})\\n\\s*((?:Tiny|Small|Medium|Large|Huge|Gargantuan)(?: or (?:Tiny|Small|Medium|Large|Huge|Gargantuan))? ${creatureType}(?: \\([^)]+\\))?, [^\\n]+)\\s*$`,
  "gm",
);
const starts = [...monsterText.matchAll(header)];
const monsters: ThingDocument[] = [];
for (let index = 0; index < starts.length; index++) {
  const match = starts[index];
  const name = clean(match[1]);
  if (/^(Actions|Traits|Reactions|Bonus Actions|Legendary Actions)$/i.test(name)) continue;
  const end = starts[index + 1]?.index ?? monsterText.length;
  const body = clean(monsterText.slice(match.index!, end));
  const type = clean(match[2]);
  const ac = body.match(/\bAC\s+([^\n]+?)(?=\s+Initiative|\n)/)?.[1] ?? "—";
  const hpMatch = body.match(/\bHP\s+(\d+)\s*(?:\(([^)]+)\))?/);
  const speed = body.match(/\bSpeed\s+([^\n]+)/)?.[1] ?? "—";
  const cr = body.match(/\bCR\s+([^\n]+)/)?.[1] ?? "—";
  const abilities = [...body.matchAll(/\b(Str|Dex|Con|Int|Wis|Cha)\s+(\d+)\s+[+−-]\d+/g)];
  const abilityFields = abilities.slice(0, 6).map((ability) =>
    field(ability[1].toLowerCase(), ability[1].toUpperCase(), ability[2], "Ability Scores"),
  );
  const details = ["Gear", "Skills", "Resistances", "Immunities", "Vulnerabilities", "Senses", "Languages"]
    .flatMap((label) => {
      const found = body.match(new RegExp(`(?:^|\\n)${label} ([^\\n]+)`));
      return found ? [field(slug(label), label, found[1])] : [];
    });
  const sectionNames = ["Traits", "Actions", "Bonus Actions", "Reactions", "Legendary Actions"];
  const sections = sectionNames.flatMap((sectionName) => {
    const sectionStart = body.search(new RegExp(`(?:^|\\n)${sectionName}\\n`));
    if (sectionStart < 0) return [];
    const contentStart = sectionStart + body.slice(sectionStart).indexOf("\n") + 1;
    const next = sectionNames
      .map((candidate) => body.indexOf(`\n${candidate}\n`, contentStart))
      .filter((position) => position >= 0)
      .sort((a, b) => a - b)[0] ?? body.length;
    const text = body.slice(contentStart, next).trim();
    return text
      ? [{ id: slug(sectionName), name: sectionName, entries: [{ id: "rules", name: sectionName, text }] }]
      : [];
  });
  const statBlock: StatBlock = {
    version: 1,
    system: "D&D 5e (2024 SRD)",
    source: "System Reference Document 5.2.1, CC BY 4.0",
    resources: hpMatch ? [{ id: "hp", label: "Hit Points", value: Number(hpMatch[1]), max: Number(hpMatch[1]) }] : [],
    fields: [
      field("type", "Type", type),
      field("ac", "Armor Class", ac),
      ...(hpMatch?.[2] ? [field("hit-dice", "Hit Dice", hpMatch[2])] : []),
      field("speed", "Speed", speed),
      ...abilityFields,
      ...details,
      field("challenge", "Challenge", cr),
    ],
    sections,
  };
  const id = `srd52-monster-${slug(name)}`;
  try {
    monsters.push(baseDocument(id, name, "creature", `${type}. Rules text from the 5.2.1 SRD.`, ["creature", "monster", "srd", "dnd5e-2024"], statBlock));
  } catch (error) {
    console.warn(`Skipped malformed monster ${name}: ${String(error)}`);
  }
}

// Equipment tables are much more reliable than prose headings. Parse the
// fixed-width table rows and preserve every column as generic fields.
const equipmentFile = join(tmp, "equipment.txt");
extract(91, 100, equipmentFile);
const equipmentText = await readFile(equipmentFile, "utf8");
type Equipment = { name: string; category: string; fields: Record<string, string> };
const equipment = new Map<string, Equipment>();
// One reusable Thing per item name. A mount such as a Mastiff can also appear
// elsewhere in the rules, but placements should still reference one identity.
const addEquipment = (item: Equipment) => equipment.set(slug(item.name), item);
let weaponCategory = "";
for (const line of equipmentText.split("\n")) {
  const category = line.trim().match(/^(Simple|Martial) (Melee|Ranged) Weapons$/);
  if (category) weaponCategory = `${category[1]} ${category[2]} Weapon`;
  const row = line.match(/^\s{6}([A-Z][A-Za-z ]+?)\s{2,}(\d+d?\d*|\d+) (Bludgeoning|Piercing|Slashing)\s{2,}(.+?)\s{2,}(Cleave|Graze|Nick|Push|Sap|Slow|Topple|Vex)\s{2,}(.+?)\s{2,}([\d,]+ (?:CP|SP|GP))\s*$/);
  if (row && weaponCategory) addEquipment({ name: row[1].trim(), category: weaponCategory, fields: { Damage: `${row[2]} ${row[3]}`, Properties: row[4].trim(), Mastery: row[5], Weight: row[6].trim(), Cost: row[7] } });
}
const armorBlock = equipmentText.match(/\n\s*Armor\n\s*Armor\s+Armor Class \(AC\)[\s\S]+?\n\s*92\s+System Reference/)?.[0] ?? "";
let armorCategory = "";
for (const line of armorBlock.split("\n")) {
  const category = line.trim().match(/^(Light|Medium|Heavy) Armor/);
  if (category) armorCategory = `${category[1]} Armor`;
  if (/^Shield \(/.test(line.trim())) armorCategory = "Shield";
  const row = line.match(/^\s{7}([A-Z][A-Za-z ]+?)\s{2,}(.+?)\s{2,}(—|Str \d+)\s{2,}(—|Disadvantage)\s{2,}(.+?)\s{2,}([\d,]+ GP)\s*$/);
  if (row && armorCategory) addEquipment({ name: row[1].trim(), category: armorCategory, fields: { "Armor Class": row[2].trim(), Strength: row[3], Stealth: row[4], Weight: row[5].trim(), Cost: row[6] } });
}
const gearTable = equipmentText.match(/\n\s*Adventuring Gear\s+Item[\s\S]+?\n\s*95\s+System Reference/)?.[0] ?? "";
for (const line of gearTable.split("\n")) {
  const halves = [line.slice(0, 55), line.slice(55)];
  for (const half of halves) {
    const row = half.match(/^\s*([A-Z][A-Za-z’'(), -]+?)\s{2,}(.+?)\s{2,}([\d,]+ (?:CP|SP|GP)|Varies)\s*$/);
    if (row && !/^(Item|Adventuring Gear)$/.test(row[1].trim())) addEquipment({ name: row[1].trim(), category: "Adventuring Gear", fields: { Weight: row[2].trim(), Cost: row[3] } });
  }
}
const tools: [string, string][] = [
  ["Alchemist’s Supplies", "50 GP"], ["Brewer’s Supplies", "20 GP"], ["Calligrapher’s Supplies", "10 GP"],
  ["Carpenter’s Tools", "8 GP"], ["Cartographer’s Tools", "15 GP"], ["Cobbler’s Tools", "5 GP"],
  ["Cook’s Utensils", "1 GP"], ["Glassblower’s Tools", "30 GP"], ["Jeweler’s Tools", "25 GP"],
  ["Leatherworker’s Tools", "5 GP"], ["Mason’s Tools", "10 GP"], ["Painter’s Supplies", "10 GP"],
  ["Potter’s Tools", "10 GP"], ["Smith’s Tools", "20 GP"], ["Tinker’s Tools", "50 GP"],
  ["Weaver’s Tools", "1 GP"], ["Woodcarver’s Tools", "1 GP"], ["Disguise Kit", "25 GP"],
  ["Forgery Kit", "15 GP"], ["Gaming Set", "Varies"], ["Herbalism Kit", "5 GP"],
  ["Musical Instrument", "Varies"], ["Navigator’s Tools", "25 GP"], ["Poisoner’s Kit", "50 GP"],
  ["Thieves’ Tools", "25 GP"],
];
for (const [name, cost] of tools) addEquipment({ name, category: "Tool", fields: { Cost: cost } });
const mountsAndVehicles: Equipment[] = [
  ["Camel", "Mount", "450 lb.", "50 GP"], ["Elephant", "Mount", "1,320 lb.", "200 GP"],
  ["Horse, Draft", "Mount", "540 lb.", "50 GP"], ["Horse, Riding", "Mount", "480 lb.", "75 GP"],
  ["Mastiff", "Mount", "195 lb.", "25 GP"], ["Mule", "Mount", "420 lb.", "8 GP"],
  ["Pony", "Mount", "225 lb.", "30 GP"], ["Warhorse", "Mount", "540 lb.", "400 GP"],
].map(([name, category, capacity, cost]) => ({ name, category, fields: { "Carrying Capacity": capacity, Cost: cost } }));
for (const [name, weight, cost] of [
  ["Carriage", "600 lb.", "100 GP"], ["Cart", "200 lb.", "15 GP"], ["Chariot", "100 lb.", "250 GP"],
  ["Saddle, Exotic", "40 lb.", "60 GP"], ["Saddle, Military", "30 lb.", "20 GP"], ["Saddle, Riding", "25 lb.", "10 GP"],
  ["Sled", "300 lb.", "20 GP"], ["Wagon", "400 lb.", "35 GP"],
]) mountsAndVehicles.push({ name, category: "Tack and Vehicle", fields: { Weight: weight, Cost: cost } });
for (const [name, speed, crew, passengers, cargo, ac, hp, threshold, cost] of [
  ["Airship", "8 mph", "10", "20", "1 ton", "13", "300", "—", "40,000 GP"],
  ["Galley", "4 mph", "80", "—", "150 tons", "15", "500", "20", "30,000 GP"],
  ["Keelboat", "1 mph", "1", "6", "1/2 ton", "15", "100", "10", "3,000 GP"],
  ["Longship", "3 mph", "40", "150", "10 tons", "15", "300", "15", "10,000 GP"],
  ["Rowboat", "1½ mph", "1", "3", "—", "11", "50", "—", "50 GP"],
  ["Sailing Ship", "2 mph", "20", "20", "100 tons", "15", "300", "15", "10,000 GP"],
  ["Warship", "2½ mph", "60", "60", "200 tons", "15", "500", "20", "25,000 GP"],
]) mountsAndVehicles.push({ name, category: "Large Vehicle", fields: { Speed: speed, Crew: crew, Passengers: passengers, Cargo: cargo, "Armor Class": ac, "Hit Points": hp, "Damage Threshold": threshold, Cost: cost } });
for (const item of mountsAndVehicles) addEquipment(item);

await rm(output, { recursive: true, force: true });
for (const monster of monsters) await writeThing("monsters", monster);
const equipmentDocuments: ThingDocument[] = [];
for (const item of equipment.values()) {
  const id = `srd52-equipment-${slug(item.name)}`;
  const statBlock: StatBlock = {
    version: 1,
    system: "D&D 5e (2024 SRD)",
    source: "System Reference Document 5.2.1, CC BY 4.0",
    resources: [],
    fields: [field("category", "Category", item.category), ...Object.entries(item.fields).map(([label, value]) => field(slug(label), label, value))],
    sections: [],
  };
  const document = baseDocument(id, item.name, "item", `${item.category} from the 5.2.1 SRD.`, ["item", "equipment", "srd", "dnd5e-2024", slug(item.category)], statBlock);
  equipmentDocuments.push(document);
  await writeThing("equipment", document);
}
const monsterRoot = baseDocument("srd52-monster-library", "SRD 5.2.1 Monsters", "place", "A reusable library of creatures from the Creative Commons–licensed System Reference Document 5.2.1.", ["library", "creature", "srd", "dnd5e-2024"], undefined, monsters.map((m, i) => placement(m.thing.id, i)));
const equipmentRoot = baseDocument("srd52-equipment-library", "SRD 5.2.1 Equipment", "place", "A reusable library of equipment from the Creative Commons–licensed System Reference Document 5.2.1.", ["library", "item", "equipment", "srd", "dnd5e-2024"], undefined, equipmentDocuments.map((d, i) => placement(d.thing.id, i)));
await writeThing("", monsterRoot);
await writeThing("", equipmentRoot);
await writeFile(join(output, "LICENSE.md"), `# SRD 5.2.1 attribution\n\nRules content in this directory is derived from the **System Reference Document 5.2.1**, copyright Wizards of the Coast LLC, and is used under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/).\n\nWikiTop's code and original presentation remain covered by the repository licenses.\n`);
await writeFile(join(output, "IMPORT-REPORT.json"), `${JSON.stringify({ source: basename(source), license: "CC BY 4.0", monsters: monsters.length, equipment: equipmentDocuments.length }, null, 2)}\n`);
await rm(tmp, { recursive: true, force: true });
console.log(`Wrote ${monsters.length} monsters and ${equipmentDocuments.length} equipment Things to ${output}.`);
