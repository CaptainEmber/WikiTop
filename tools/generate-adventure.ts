import { mkdir, readFile, writeFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { resolve } from "node:path";
import {
  exportThingGlb,
  importThingGlb,
  ThingDocumentSchema,
  type EmbeddedMedia,
  type StatBlock,
  type ThingDocument,
  type ThingPlacement,
  type Visual,
} from "@wikitop/thing-format";

if (!globalThis.crypto)
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });

const slug = process.argv[2] ?? "murkmire-malevolence";
if (slug !== "murkmire-malevolence")
  throw new Error(`No adventure adapter is registered for ${slug}`);
const root = resolve("adventures", slug),
  source = resolve(root, "source"),
  manifestDir = resolve(root, "manifest"),
  output = resolve(root, "generated");
const required = {
  markdown: "adventure.md",
  playerMap: "museum-player-map.png",
  dmMap: "museum-dm-map.png",
  handout: "dannell-handout.png",
};
const missing: string[] = [];
for (const name of Object.values(required))
  try {
    await readFile(resolve(source, name));
  } catch {
    missing.push(name);
  }
if (missing.length)
  throw new Error(`Missing private adventure sources: ${missing.join(", ")}`);
const markdown = await readFile(resolve(source, required.markdown), "utf8"),
  playerMap = new Uint8Array(
    await readFile(resolve(source, required.playerMap)),
  ),
  handout = new Uint8Array(await readFile(resolve(source, required.handout)));
for (const [name, bytes] of [
  [required.playerMap, playerMap],
  [required.handout, handout],
] as const)
  if (Buffer.from(bytes.subarray(0, 8)).toString("hex") !== "89504e470d0a1a0a")
    throw new Error(`${name} is not a PNG file`);
const emptyPage = (width = 16, depth = 12) => ({
  width,
  depth,
  zones: [],
  doors: [],
  anchors: [
    {
      id: "entrance",
      name: "Entrance",
      position: [0, 0, 0] as [number, number, number],
    },
  ],
  placements: [] as ThingPlacement[],
});
const doc = (
  id: string,
  name: string,
  kind: ThingDocument["thing"]["kind"],
  description: string,
  tags: string[],
  extra: Partial<ThingDocument["thing"]> = {},
): ThingDocument =>
  ThingDocumentSchema.parse({
    schemaVersion: 2,
    thing: {
      id,
      name,
      kind,
      description,
      tags,
      face: { media: {} },
      page: emptyPage(),
      ...extra,
    },
  });
const at = (
  id: string,
  targetId: string,
  x: number,
  y: number,
  name?: string,
  hidden?: boolean,
  face?: Visual,
): ThingPlacement => ({
  id,
  targetId,
  ...(name ? { name } : {}),
  position: [x, y, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
  ...(hidden ? { hidden: true } : {}),
  ...(face ? { face } : {}),
});
const section = (key: string) => {
  const marker = `#### ${key}`,
    start = markdown.indexOf(marker);
  if (start < 0) return "";
  const body = markdown.indexOf("\n", start) + 1,
    next = markdown.slice(body).search(/^#{2,4} /m);
  return markdown.slice(body, next < 0 ? undefined : body + next).trim();
};
async function published(id: string) {
  const bytes = await readFile(resolve("world/srd", `${id}.glb`)),
    item = await importThingGlb(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      `${id}.glb`,
    );
  return item;
}
const bases = Object.fromEntries(
  await Promise.all(
    [
      "srd-guard",
      "srd-commoner",
      "srd-noble",
      "srd-animated-armor",
      "srd-mimic",
      "srd-allosaurus",
      "srd-ankheg",
      "srd-behir",
    ].map(async (id) => [id, await published(id)]),
  ),
);
const outputs: {
  document: ThingDocument;
  media: Map<string, EmbeddedMedia>;
}[] = [];
const add = (
  document: ThingDocument,
  media = new Map<string, EmbeddedMedia>(),
) => {
  outputs.push({ document, media });
  return document;
};
const variant = (
  id: string,
  name: string,
  baseId: string,
  description: string,
  change?: (block: StatBlock) => void,
) => {
  const base = bases[baseId].document,
    stat = structuredClone(base.thing.statBlock)!;
  change?.(stat);
  return add(
    doc(
      id,
      name,
      "creature",
      description,
      ["creature", "murkmire-malevolence"],
      { face: structuredClone(base.thing.face), statBlock: stat },
    ),
    bases[baseId].media,
  );
};
const dr = structuredClone(bases["srd-commoner"].document.thing.statBlock)!;
dr.fields.find((x) => x.id === "int")!.value = 18;
add(
  doc(
    "mm-dr-cassee-dannell",
    "Dr. Cassee Dannell",
    "character",
    "A brilliant anthropologist who knows the Murkmire Stone is an eldritch egg and needs the party's help.",
    ["character", "npc", "murkmire-malevolence"],
    { statBlock: dr },
  ),
);
add(
  doc(
    "mm-alda-arkin",
    "Alda Arkin",
    "character",
    "The museum's curator, a retired professor who dismisses Dr. Dannell's warnings.",
    ["character", "npc", "murkmire-malevolence"],
    { statBlock: structuredClone(bases["srd-noble"].document.thing.statBlock) },
  ),
);
const scarecrow: StatBlock = {
  version: 1,
  system: "D&D 5e",
  source: "Private adventure reference",
  resources: [{ id: "hp", label: "Hit Points", value: 36, max: 36 }],
  fields: [
    { id: "type", label: "Type", value: "Medium construct" },
    { id: "ac", label: "Armor Class", value: 11 },
    { id: "speed", label: "Speed", value: "30 ft." },
    { id: "str", label: "STR", value: 11, group: "Ability Scores" },
    { id: "dex", label: "DEX", value: 13, group: "Ability Scores" },
    { id: "con", label: "CON", value: 11, group: "Ability Scores" },
    { id: "int", label: "INT", value: 10, group: "Ability Scores" },
    { id: "wis", label: "WIS", value: 10, group: "Ability Scores" },
    { id: "cha", label: "CHA", value: 13, group: "Ability Scores" },
  ],
  sections: [
    {
      id: "traits",
      name: "Traits",
      entries: [
        {
          id: "false-appearance",
          name: "False Appearance",
          text: "While motionless, Marigold is indistinguishable from an inanimate doll.",
        },
      ],
    },
    {
      id: "actions",
      name: "Actions",
      entries: [
        {
          id: "multiattack",
          name: "Multiattack",
          text: "Makes two claw attacks.",
        },
        {
          id: "claw",
          name: "Claw",
          text: "Melee attack; a struck creature may be frightened.",
        },
        {
          id: "glare",
          name: "Terrifying Glare",
          text: "A visible creature within 30 feet may become frightened and paralyzed.",
        },
      ],
    },
  ],
};
add(
  doc(
    "mm-marigold",
    "Marigold",
    "creature",
    "A five-foot-tall vintage doll that animates after hours and uses the scarecrow statistics.",
    ["creature", "construct", "murkmire-malevolence"],
    { statBlock: scarecrow },
  ),
);
variant(
  "mm-animatronic-allosaurus",
  "Animatronic Allosaurus",
  "srd-allosaurus",
  "A harmless museum display until its controls are overloaded; then it rampages as a Construct for ten minutes.",
  (b) => {
    b.fields.find((x) => x.id === "type")!.value = "Large construct";
    b.fields.push({
      id: "immunities",
      label: "Immunities",
      value:
        "poison and psychic damage; charmed, frightened, paralyzed, and poisoned conditions",
    });
  },
);
variant(
  "mm-nascent-eldritch-horror",
  "Nascent Eldritch Horror",
  "srd-ankheg",
  "A newly hatched eldritch creature. Its bite deals poison damage instead of acid damage.",
);
variant(
  "mm-juvenile-eldritch-horror",
  "Juvenile Eldritch Horror",
  "srd-behir",
  "An enormous, highly intelligent eldritch horror that uses behir statistics and gains innate spellcasting.",
  (b) => {
    b.fields.find((x) => x.id === "int")!.value = 18;
    b.fields.find((x) => x.id === "languages")!.value = "—";
    b.sections.push({
      id: "spellcasting",
      name: "Additional Actions",
      entries: [
        {
          id: "spellcasting-action",
          name: "Spellcasting",
          text: "Without components (save DC 14): blindness/deafness and blur twice per day each; project image once per day.",
        },
      ],
    });
  },
);
add(
  doc(
    "mm-murkmire-stone",
    "Murkmire Stone",
    "object",
    "A ten-pound opaque light-green eldritch egg with abstract furrows. It begins pulsing at 10:30 p.m. and hatches at midnight unless sealed in Dr. Dannell's crystal box.",
    ["object", "quest-item", "murkmire-malevolence"],
  ),
);
add(
  doc(
    "mm-fake-murkmire-stone",
    "Jade Stone",
    "object",
    "A chunk of jade similar in size and weight to the Murkmire Stone, suitable for defeating the pedestal's weight-sensitive defense.",
    ["object", "decoy", "murkmire-malevolence"],
  ),
);
const roomNames = [
  "Grand Entrance",
  "Museum Shops",
  "Ancient Plants Exhibit",
  "Ancient Cultures Exhibit",
  "Curator's Office",
  "Records Room",
  "Break Room and Storage",
  "Creatures of the Past Exhibit",
  "Underground Wonders Exhibit",
  "Archaeology Display",
  "Unearthed Café",
  "Prehistoric Predators Exhibit",
  "Gemstone Wing",
  "Access Hallway",
  "Privies",
  "Basement",
  "Attic",
];
for (let i = 1; i <= 17; i++)
  add(
    doc(
      `mm-room-v${i}`,
      `V${i}: ${roomNames[i - 1]}`,
      "place",
      section(`V${i}:`) || `Game Master notes for area V${i}.`,
      ["note", "room", "gm", "murkmire-malevolence"],
    ),
  );
add(
  doc(
    "mm-sages-quill",
    "The Sage's Quill",
    "place",
    section("The Clock Is Ticking") ||
      "A quiet, plush tavern beside the museum where Dr. Dannell briefs the party.",
    ["place", "tavern", "murkmire-malevolence"],
    {
      page: {
        ...emptyPage(18, 14),
        placements: [
          at("dr-dannell", "mm-dr-cassee-dannell", 0, 0, "Dr. Cassee Dannell"),
        ],
      },
    },
  ),
);
const handoutMedia = new Map<string, EmbeddedMedia>([
  [
    "dannell-handout",
    { id: "dannell-handout", mimeType: "image/png", bytes: handout },
  ],
]);
add(
  doc(
    "mm-dannell-map",
    "Dr. Dannell's Museum Map",
    "object",
    "An incomplete player handout based on the museum's public exhibit map.",
    ["handout", "map", "murkmire-malevolence"],
    {
      page: {
        ...emptyPage(77, 100),
        background: {
          kind: "embedded",
          mediaId: "dannell-handout",
          type: "image",
          mimeType: "image/png",
        },
      },
    },
  ),
  handoutMedia,
);
const museumMedia = new Map<string, EmbeddedMedia>([
  [
    "museum-player-map",
    { id: "museum-player-map", mimeType: "image/png", bytes: playerMap },
  ],
]);
function mapToken(baseId: string, key: string, width = 1.1) {
  const base = bases[baseId],
    entry = [...base.media.values()][0],
    id = `museum-token-${key}`;
  museumMedia.set(id, { ...entry, id, bytes: entry.bytes.slice() });
  return {
    mode: "token" as const,
    assetId: id,
    width,
    height: width,
    anchor: [0.5, 0.5] as [number, number],
    footprint: [width, width] as [number, number],
  };
}
const guardFace = mapToken("srd-guard", "guard"),
  armorFace = mapToken("srd-animated-armor", "armor"),
  mimicFace = mapToken("srd-mimic", "mimic"),
  allosaurusFace = mapToken("srd-allosaurus", "allosaurus", 2);
const pixel = (x: number, y: number): [number, number] => [
  (x / 1700 - 0.5) * 77,
  (0.5 - y / 2210) * 100,
];
const placements: Array<ThingPlacement> = [];
const roomPixels: [[number, number], ...[number, number][]] = [
  [760, 1640],
  [700, 1430],
  [500, 1610],
  [335, 1610],
  [1115, 1840],
  [1115, 1680],
  [1120, 1480],
  [470, 1040],
  [760, 1040],
  [1090, 1040],
  [380, 810],
  [735, 815],
  [1070, 810],
  [690, 625],
  [1040, 625],
  [1110, 360],
  [465, 400],
];
roomPixels.forEach((p, i) =>
  placements.push(
    at(
      `note-v${i + 1}`,
      `mm-room-v${i + 1}`,
      ...pixel(...p),
      `V${i + 1}`,
      true,
    ),
  ),
);
const guards = [
  ["Darrison Blackwaters", 700, 1600],
  ["Franceena Van Lictor", 835, 1660],
  ["Billie Quartermile", 500, 1580],
  ["Milanova Wumplestocking", 335, 1590],
  ["Garent Millaneff", 455, 1030],
  ["Violet Pendergilt", 760, 1030],
  ["Sureth Dhanvhal", 1090, 1030],
  ["Brendara Valindril", 380, 800],
  ["Grendor Battleaxe", 700, 790],
  ["Clark Jonathan Vanth", 805, 850],
  ["Sareena Shu", 1040, 800],
  ["Maryam Bikram", 1105, 865],
] as const;
guards.forEach(([name, x, y], i) =>
  placements.push(
    at(`guard-${i + 1}`, "srd-guard", ...pixel(x, y), name, false, guardFace),
  ),
);
placements.push(
  at(
    "armor-v1-west",
    "srd-animated-armor",
    ...pixel(650, 1770),
    "Robed Statue",
    false,
    armorFace,
  ),
  at(
    "armor-v1-east",
    "srd-animated-armor",
    ...pixel(850, 1770),
    "Robed Statue",
    false,
    armorFace,
  ),
  at(
    "armor-v12",
    "srd-animated-armor",
    ...pixel(825, 840),
    "Winged Satyr Statue",
    false,
    armorFace,
  ),
  at("marigold", "mm-marigold", ...pixel(1120, 1840), "Vintage Doll"),
  at(
    "basement-mimic",
    "srd-mimic",
    ...pixel(1050, 390),
    "Mimic",
    true,
    mimicFace,
  ),
  at(
    "animatronic-allosaurus",
    "mm-animatronic-allosaurus",
    ...pixel(670, 815),
    "Allosaurus Display",
    false,
    allosaurusFace,
  ),
  at(
    "murkmire-stone",
    "mm-murkmire-stone",
    ...pixel(1065, 815),
    "Murkmire Stone",
  ),
  at(
    "fake-stone",
    "mm-fake-murkmire-stone",
    ...pixel(760, 1030),
    "Jade Stone",
    true,
  ),
);
const museum = add(
  doc(
    "mm-varkenbluff-museum",
    "Varkenbluff Museum of Natural History",
    "place",
    "A four-level natural-history museum shown on one composite map. One map square represents 5 feet.",
    ["place", "museum", "murkmire-malevolence"],
    {
      page: {
        ...emptyPage(77, 100),
        background: {
          kind: "embedded",
          mediaId: "museum-player-map",
          type: "image",
          mimeType: "image/png",
        },
        placements,
      },
    },
  ),
  museumMedia,
);
add(
  doc(
    "mm-murkmire-malevolence",
    "The Murkmire Malevolence",
    "place",
    "A private, prepared heist adventure for 1st-level characters. Meet Dr. Dannell, scout the museum, and recover the Murkmire Stone before midnight.",
    ["adventure", "heist", "murkmire-malevolence"],
    {
      page: {
        ...emptyPage(24, 18),
        placements: [
          at("briefing", "mm-sages-quill", -6, 0, "Begin at the Sage's Quill"),
          at("museum", "mm-varkenbluff-museum", 5, 0, "Varkenbluff Museum"),
          at("handout", "mm-dannell-map", 0, -5, "Dr. Dannell's Map"),
        ],
      },
    },
  ),
);
await mkdir(manifestDir, { recursive: true });
await mkdir(output, { recursive: true });
const pack = [];
for (const item of outputs) {
  const bytes = new Uint8Array(await exportThingGlb(item.document, item.media)),
    filename = `${item.document.thing.id}.glb`;
  await writeFile(resolve(output, filename), bytes);
  pack.push({
    id: item.document.thing.id,
    name: item.document.thing.name,
    file: filename,
    links: item.document.thing.page.placements.map((p) => p.targetId),
  });
}
await writeFile(
  resolve(manifestDir, "pack.json"),
  JSON.stringify(
    {
      version: 1,
      id: "murkmire-malevolence",
      rootId: "mm-murkmire-malevolence",
      private: true,
      things: pack,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Generated ${pack.length} private Things in ${output}`);
