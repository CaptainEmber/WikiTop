import { webcrypto } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import {
  exportThingGlb,
  ThingDocumentSchema,
  type ThingDocument,
  type ThingPlacement,
} from "@wikitop/thing-format";

if (!globalThis.crypto)
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
const page = (width = 20, depth = 16, placements: ThingPlacement[] = []) => ({
  width,
  depth,
  zones: [],
  doors: [],
  anchors: [
    {
      id: "center",
      name: "Center",
      position: [0, 0, 0] as [number, number, number],
    },
  ],
  placements,
});
const place = (
  id: string,
  name: string,
  description: string,
  placements: ThingPlacement[] = [],
): ThingDocument =>
  ThingDocumentSchema.parse({
    schemaVersion: 2,
    thing: {
      id,
      name,
      description,
      kind: "place",
      tags: ["plane", "cosmology", "srd"],
      face: { media: {} },
      page: page(
        placements.length > 8 ? 34 : 24,
        placements.length > 8 ? 26 : 18,
        placements,
      ),
    },
  });
const at = (
  id: string,
  targetId: string,
  x: number,
  y: number,
  name?: string,
): ThingPlacement => ({
  id,
  targetId,
  ...(name ? { name } : {}),
  position: [x, y, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});
const ring = (ids: string[], radius = 10) =>
  ids.map((targetId, i) => {
    const a = Math.PI / 2 - (i * Math.PI * 2) / ids.length;
    return at(
      `to-${targetId}`,
      targetId,
      Math.cos(a) * radius,
      Math.sin(a) * radius,
    );
  });

const descriptions: Record<string, [string, string]> = {
  "plane-material": [
    "Material Plane",
    "The meeting place of elemental substance and spiritual possibility, where mortal worlds develop in all their variety. Most adventures begin here, and the other planes are commonly described by how they relate to it.",
  ],
  "plane-feywild": [
    "Feywild",
    "A vivid echo of the Material Plane where nature, magic, beauty, danger, and emotion are all heightened. Familiar landmarks can have strange counterparts here, and distance or time may refuse to behave predictably.",
  ],
  "plane-shadowfell": [
    "Shadowfell",
    "A dim echo of the Material Plane shaped by loss, stillness, and decay. Its muted landscapes resemble mortal places stripped of warmth, while hidden domains gather around particularly powerful tragedies.",
  ],
  "plane-astral": [
    "Astral Plane",
    "A silvery expanse of thought and dream that provides passage toward the Outer Planes. Travelers cross it among drifting fragments, distant lights, and color pools opening onto other realities.",
  ],
  "plane-ethereal": [
    "Ethereal Plane",
    "A mist-filled transitive reality overlapping the Material and Inner Planes. Its near reaches mirror neighboring locations, while its deeper mists form a strange ocean between them.",
  ],
  "plane-border-ethereal": [
    "Border Ethereal",
    "The shallow region of the Ethereal Plane that overlaps a neighboring plane location for location. Ethereal travelers can observe the nearby world as though through concealing mist.",
  ],
  "plane-deep-ethereal": [
    "Deep Ethereal",
    "A shifting expanse of luminous fog beyond the Border Ethereal. Curtains of color and uncertain currents lead toward distant border regions and other Inner Planes.",
  ],
  "plane-air": [
    "Elemental Plane of Air",
    "An open realm of endless sky, roaming storms, floating earth, and airborne settlements. Solid ground is exceptional rather than expected.",
  ],
  "plane-earth": [
    "Elemental Plane of Earth",
    "A crushing infinity of stone, mineral veins, caverns, and moving faults. Habitable spaces are islands of emptiness inside an otherwise solid world.",
  ],
  "plane-fire": [
    "Elemental Plane of Fire",
    "A domain of flame, ash, heat, and incandescent seas where survival depends on rare protected regions. The City of Brass is its best-known metropolis.",
  ],
  "plane-water": [
    "Elemental Plane of Water",
    "An immeasurable ocean with no necessary surface or floor, broken by currents, reefs, air pockets, and drifting settlements.",
  ],
  "plane-positive": [
    "Positive Plane",
    "A source of overwhelming vitality, radiance, and creative energy. Its abundance is as dangerous to finite visitors as any destructive force.",
  ],
  "plane-negative": [
    "Negative Plane",
    "A realm of entropy, emptiness, and life-consuming energy. Its influence is closely associated with decay and the animation of the dead.",
  ],
  "plane-elemental-chaos": [
    "Elemental Chaos",
    "The tumultuous frontier where pure elements lose their boundaries and collide. Fire, water, air, and earth combine here in unstable and often impossible forms.",
  ],
  "plane-arcadia": [
    "Arcadia",
    "A peaceful Outer Plane of ordered harmony, cooperative labor, and carefully tended perfection.",
  ],
  "plane-mount-celestia": [
    "Mount Celestia",
    "A luminous mountain of justice, discipline, and spiritual ascent whose paths lead upward toward increasingly transcendent realms.",
  ],
  "plane-bytopia": [
    "Bytopia",
    "A industrious plane of community and honest craft, formed as two inhabited realms facing one another across a shared sky.",
  ],
  "plane-elysium": [
    "Elysium",
    "A gentle plane of compassion, freedom, and contentment, shaped by beautiful lands and life-giving waters.",
  ],
  "plane-beastlands": [
    "The Beastlands",
    "An untamed wilderness of idealized nature, endless cycles of day and night, and creatures living by instinct.",
  ],
  "plane-arborea": [
    "Arborea",
    "A passionate realm of heroic emotion, ancient forests, wild seas, revelry, and sudden danger.",
  ],
  "plane-ysgard": [
    "Ysgard",
    "A heroic plane of rugged worlds, glorious contests, and warriors who rise again after worthy battle.",
  ],
  "plane-limbo": [
    "Limbo",
    "A plane of pure change where matter and landscape continuously dissolve and reform under will, accident, and chaos.",
  ],
  "plane-pandemonium": [
    "Pandemonium",
    "A lightless maze of caverns scoured by ceaseless winds that carry voices, debris, and madness through the dark.",
  ],
  "plane-abyss": [
    "The Abyss",
    "A seemingly endless succession of hostile layers shaped by corruption, ruin, and demonic power.",
  ],
  "plane-carceri": [
    "Carceri",
    "A prison plane of isolated worlds, bitter exile, broken trust, and paths that are far easier to enter than leave.",
  ],
  "plane-hades": [
    "Hades",
    "A colorless plane of despair and spiritual exhaustion where hope and identity gradually wear away.",
  ],
  "plane-gehenna": [
    "Gehenna",
    "A harsh plane of steep volcanic slopes, perilous bargains, and ambition pursued without mercy.",
  ],
  "plane-nine-hells": [
    "The Nine Hells",
    "A lawful realm of tyranny, contracts, punishment, and infernal hierarchy divided into nine descending layers.",
  ],
  "plane-acheron": [
    "Acheron",
    "A plane of endless conflict where armies struggle across colossal geometric worlds suspended in an iron void.",
  ],
  "plane-mechanus": [
    "Mechanus",
    "A perfectly ordered plane of interlocking mechanisms, absolute law, and systems operating on a cosmic scale.",
  ],
  "hell-avernus": [
    "Avernus",
    "The first Hell is a scarred battlefield of ash, fire, fortifications, and armies contesting the infernal frontier.",
  ],
  "hell-dis": [
    "Dis",
    "The second Hell is dominated by an immense iron city of walls, furnaces, crowded streets, and relentless surveillance.",
  ],
  "hell-minauros": [
    "Minauros",
    "The third Hell is a sinking realm of foul marshes, corrosive rain, greed, and structures forever settling into the mire.",
  ],
  "hell-phlegethos": [
    "Phlegethos",
    "The fourth Hell burns with rivers of fire, volcanic wastes, fierce passions, and courts that turn law into torment.",
  ],
  "hell-stygia": [
    "Stygia",
    "The fifth Hell is a frozen sea of crushing ice, hidden depths, drifting fortresses, and bitter old grudges.",
  ],
  "hell-malbolge": [
    "Malbolge",
    "The sixth Hell is a treacherous landscape of unstable slopes, falling stone, buried ruins, and oppressive rule.",
  ],
  "hell-maladomini": [
    "Maladomini",
    "The seventh Hell is crowded with abandoned cities, poisoned industry, failed monuments, and ceaseless attempts at improvement.",
  ],
  "hell-cania": [
    "Cania",
    "The eighth Hell is a lethal realm of supernatural cold, moving glaciers, isolated citadels, and hoarded arcane knowledge.",
  ],
  "hell-nessus": [
    "Nessus",
    "The ninth and deepest Hell is a realm of vast chasms and supreme infernal authority, remote from all lesser layers.",
  ],
  "realm-city-of-brass": [
    "City of Brass",
    "A vast fortified city on the Plane of Fire, famed for its markets, metalwork, palaces, and dangerous bargains.",
  ],
};
const outerIds = [
  "plane-arcadia",
  "plane-mount-celestia",
  "plane-bytopia",
  "plane-elysium",
  "plane-beastlands",
  "plane-arborea",
  "plane-ysgard",
  "plane-limbo",
  "plane-pandemonium",
  "plane-abyss",
  "plane-carceri",
  "plane-hades",
  "plane-gehenna",
  "plane-nine-hells",
  "plane-acheron",
  "plane-mechanus",
];
const innerIds = [
  "plane-positive",
  "plane-air",
  "plane-fire",
  "plane-earth",
  "plane-water",
  "plane-negative",
  "plane-elemental-chaos",
];
const hellIds = [
  "hell-avernus",
  "hell-dis",
  "hell-minauros",
  "hell-phlegethos",
  "hell-stygia",
  "hell-malbolge",
  "hell-maladomini",
  "hell-cania",
  "hell-nessus",
];
const documents: ThingDocument[] = [];
for (const [id, [name, description]] of Object.entries(descriptions)) {
  let placements: ThingPlacement[] = [];
  if (id === "plane-ethereal")
    placements = [
      at("to-border", "plane-border-ethereal", -4, 0),
      at("to-deep", "plane-deep-ethereal", 4, 0),
    ];
  if (id === "plane-fire")
    placements = [at("to-city-of-brass", "realm-city-of-brass", 0, 0)];
  if (id === "plane-nine-hells")
    placements = hellIds.map((x, i) => at(`to-${x}`, x, 0, 7 - i * 1.75));
  documents.push(place(id, name, description, placements));
}
documents.push(
  place(
    "planes-inner",
    "Inner Planes",
    "The Inner Planes provide the elemental substance and energetic extremes underlying the Material Plane.",
    ring(innerIds, 8),
  ),
);
documents.push(
  place(
    "planes-outer",
    "Outer Planes",
    "The Outer Planes embody spiritual, ethical, and philosophical principles. Their landscapes respond to meaning and will as readily as physical distance.",
    ring(outerIds, 11),
  ),
);
documents.push(
  place(
    "planar-system",
    "The Planar System",
    "A navigable overview of the Material Plane, its echoes, the elemental and energy planes, the spiritual Outer Planes, and the transitive realms connecting them.",
    [
      at("to-material", "plane-material", 0, 0),
      at("to-feywild", "plane-feywild", -7, 3),
      at("to-shadowfell", "plane-shadowfell", 7, 3),
      at("to-inner", "planes-inner", -7, -4),
      at("to-outer", "planes-outer", 7, -4),
      at("to-astral", "plane-astral", 0, 6),
      at("to-ethereal", "plane-ethereal", 0, -7),
    ],
  ),
);
await mkdir("world/planes", { recursive: true });
for (const document of documents)
  await writeFile(
    `world/planes/${document.thing.id}.glb`,
    new Uint8Array(await exportThingGlb(document, new Map())),
  );
console.log(`Wrote ${documents.length} planar Things.`);
