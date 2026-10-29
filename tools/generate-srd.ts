import { deflateSync } from "node:zlib";
import { webcrypto } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import {
  exportThingGlb,
  ThingDocumentSchema,
  type EmbeddedMedia,
  type StatBlock,
  type ThingDocument,
} from "@wikitop/thing-format";

if (!globalThis.crypto)
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });

type Creature = {
  id: string;
  name: string;
  color: [number, number, number];
  type: string;
  ac: string;
  hp: number;
  hitDice: string;
  speed: string;
  abilities: number[];
  challenge: string;
  details?: Record<string, string>;
  traits?: [string, string][];
  actions: [string, string][];
  reactions?: [string, string][];
};
const creatures: Creature[] = [
  {
    id: "srd-guard",
    name: "Guard",
    color: [56, 102, 125],
    type: "Medium humanoid (any race), any alignment",
    ac: "16 (chain shirt, shield)",
    hp: 11,
    hitDice: "2d8 + 2",
    speed: "30 ft.",
    abilities: [13, 12, 12, 10, 11, 10],
    challenge: "1/8 (25 XP)",
    details: {
      Skills: "Perception +2",
      Senses: "passive Perception 12",
      Languages: "any one language (usually Common)",
    },
    actions: [
      [
        "Spear",
        "Melee or Ranged Weapon Attack: +3 to hit, reach 5 ft. or range 20/60 ft., one target. Hit: 4 (1d6 + 1) piercing damage, or 5 (1d8 + 1) piercing damage when used with two hands in melee.",
      ],
    ],
  },
  {
    id: "srd-commoner",
    name: "Commoner",
    color: [126, 102, 72],
    type: "Medium humanoid (any race), any alignment",
    ac: "10",
    hp: 4,
    hitDice: "1d8",
    speed: "30 ft.",
    abilities: [10, 10, 10, 10, 10, 10],
    challenge: "0 (10 XP)",
    details: {
      Senses: "passive Perception 10",
      Languages: "any one language (usually Common)",
    },
    actions: [
      [
        "Club",
        "Melee Weapon Attack: +2 to hit, reach 5 ft., one target. Hit: 2 (1d4) bludgeoning damage.",
      ],
    ],
  },
  {
    id: "srd-noble",
    name: "Noble",
    color: [111, 72, 126],
    type: "Medium humanoid (any race), any alignment",
    ac: "15 (breastplate)",
    hp: 9,
    hitDice: "2d8",
    speed: "30 ft.",
    abilities: [11, 12, 11, 12, 14, 16],
    challenge: "1/8 (25 XP)",
    details: {
      Skills: "Deception +5, Insight +4, Persuasion +5",
      Senses: "passive Perception 12",
      Languages: "any two languages",
    },
    actions: [
      [
        "Rapier",
        "Melee Weapon Attack: +3 to hit, reach 5 ft., one target. Hit: 5 (1d8 + 1) piercing damage.",
      ],
    ],
    reactions: [
      [
        "Parry",
        "The noble adds 2 to its AC against one melee attack that would hit it, provided it can see the attacker and is wielding a melee weapon.",
      ],
    ],
  },
  {
    id: "srd-animated-armor",
    name: "Animated Armor",
    color: [93, 105, 112],
    type: "Medium construct, unaligned",
    ac: "18 (natural armor)",
    hp: 33,
    hitDice: "6d8 + 6",
    speed: "25 ft.",
    abilities: [14, 11, 13, 1, 3, 1],
    challenge: "1 (200 XP)",
    details: {
      "Damage Immunities": "poison, psychic",
      "Condition Immunities":
        "blinded, charmed, deafened, exhaustion, frightened, paralyzed, petrified, poisoned",
      Senses:
        "blindsight 60 ft. (blind beyond this radius), passive Perception 6",
      Languages: "—",
    },
    traits: [
      [
        "Antimagic Susceptibility",
        "The armor is incapacitated in an antimagic field. Dispel magic can render it unconscious for 1 minute on a failed Constitution save against the caster's spell save DC.",
      ],
      [
        "False Appearance",
        "While motionless, the armor is indistinguishable from a normal suit of armor.",
      ],
    ],
    actions: [
      ["Multiattack", "The armor makes two melee attacks."],
      [
        "Slam",
        "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) bludgeoning damage.",
      ],
    ],
  },
  {
    id: "srd-mimic",
    name: "Mimic",
    color: [113, 74, 54],
    type: "Medium monstrosity (shapechanger), neutral",
    ac: "12 (natural armor)",
    hp: 58,
    hitDice: "9d8 + 18",
    speed: "15 ft.",
    abilities: [17, 12, 15, 5, 13, 8],
    challenge: "2 (450 XP)",
    details: {
      Skills: "Stealth +5",
      "Damage Immunities": "acid",
      "Condition Immunities": "prone",
      Senses: "darkvision 60 ft., passive Perception 11",
      Languages: "—",
    },
    traits: [
      [
        "Shapechanger",
        "The mimic can use its action to polymorph into an object or back into its amorphous form.",
      ],
      [
        "Adhesive",
        "In object form, the mimic adheres to anything touching it; an adhered creature is grappled (escape DC 13).",
      ],
      [
        "False Appearance",
        "In object form while motionless, the mimic is indistinguishable from an ordinary object.",
      ],
      [
        "Grappler",
        "The mimic has advantage on attack rolls against a creature grappled by it.",
      ],
    ],
    actions: [
      [
        "Pseudopod",
        "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) bludgeoning damage; in object form, the target is subjected to Adhesive.",
      ],
      [
        "Bite",
        "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) piercing damage plus 4 (1d8) acid damage.",
      ],
    ],
  },
  {
    id: "srd-allosaurus",
    name: "Allosaurus",
    color: [64, 112, 70],
    type: "Large beast, unaligned",
    ac: "13 (natural armor)",
    hp: 51,
    hitDice: "6d10 + 18",
    speed: "60 ft.",
    abilities: [19, 13, 17, 2, 12, 5],
    challenge: "2 (450 XP)",
    details: {
      Skills: "Perception +5",
      Senses: "passive Perception 15",
      Languages: "—",
    },
    traits: [
      [
        "Pounce",
        "After moving at least 30 feet straight toward a creature and hitting it with a claw on the same turn, the target must succeed on a DC 13 Strength save or fall prone. The allosaurus can then bite it as a bonus action.",
      ],
    ],
    actions: [
      [
        "Bite",
        "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 15 (2d10 + 4) piercing damage.",
      ],
      [
        "Claw",
        "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 8 (1d8 + 4) slashing damage.",
      ],
    ],
  },
  {
    id: "srd-ankheg",
    name: "Ankheg",
    color: [105, 119, 54],
    type: "Large monstrosity, unaligned",
    ac: "14 (natural armor), 11 while prone",
    hp: 39,
    hitDice: "6d10 + 6",
    speed: "30 ft., burrow 10 ft.",
    abilities: [17, 11, 13, 1, 13, 6],
    challenge: "2 (450 XP)",
    details: {
      Senses: "darkvision 60 ft., tremorsense 60 ft., passive Perception 11",
      Languages: "—",
    },
    actions: [
      [
        "Bite",
        "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 10 (2d6 + 3) slashing plus 3 (1d6) acid damage; a Large or smaller target is grappled (escape DC 13).",
      ],
      [
        "Acid Spray (Recharge 6)",
        "The ankheg sprays a 30-foot-long, 5-foot-wide line. Creatures in it make a DC 13 Dexterity save, taking 10 (3d6) acid damage on a failure or half on a success.",
      ],
    ],
  },
  {
    id: "srd-behir",
    name: "Behir",
    color: [48, 87, 141],
    type: "Huge monstrosity, neutral evil",
    ac: "17 (natural armor)",
    hp: 168,
    hitDice: "16d12 + 64",
    speed: "50 ft., climb 40 ft.",
    abilities: [23, 16, 18, 7, 14, 12],
    challenge: "11 (7,200 XP)",
    details: {
      Skills: "Perception +6, Stealth +7",
      "Damage Immunities": "lightning",
      Senses: "darkvision 90 ft., passive Perception 16",
      Languages: "Draconic",
    },
    actions: [
      [
        "Multiattack",
        "The behir makes one bite attack and one constrict attack.",
      ],
      [
        "Bite",
        "Melee Weapon Attack: +10 to hit, reach 10 ft., one target. Hit: 22 (3d10 + 6) piercing damage.",
      ],
      [
        "Constrict",
        "Melee Weapon Attack: +10 to hit, reach 5 ft., one Large or smaller target. Hit: 17 (2d10 + 6) bludgeoning plus 17 (2d10 + 6) slashing damage; the target is grappled and restrained (escape DC 16).",
      ],
      [
        "Lightning Breath (Recharge 5–6)",
        "The behir exhales a 20-foot-long, 5-foot-wide line. Creatures make a DC 16 Dexterity save, taking 66 (12d10) lightning damage on a failure or half on a success.",
      ],
      [
        "Swallow",
        "The behir bites a grappled Medium or smaller target. On a hit the target is swallowed, blinded, restrained, and takes 21 (6d6) acid damage at the start of each behir turn.",
      ],
    ],
  },
];
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (name: string, data: Buffer) => {
  const n = Buffer.from(name),
    out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  n.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc(Buffer.concat([n, data])), 8 + data.length);
  return out;
};
const glyphs: Record<string, string[]> = {
  A: ["01110", "10001", "11111", "10001", "10001"],
  B: ["11110", "10001", "11110", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "01111"],
  G: ["01111", "10000", "10111", "10001", "01111"],
  M: ["10001", "11011", "10101", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001"],
};
function token(name: string, color: [number, number, number]) {
  const w = 256,
    h = 256,
    row = w * 4 + 1,
    raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < w; x++) {
      const dx = x - 128,
        dy = y - 128,
        r = Math.hypot(dx, dy),
        inside = r < 116,
        border = r > 104 && r < 116,
        o = y * row + 1 + x * 4;
      raw[o] = border ? 238 : inside ? color[0] : 0;
      raw[o + 1] = border ? 205 : inside ? color[1] : 0;
      raw[o + 2] = border ? 130 : inside ? color[2] : 0;
      raw[o + 3] = inside ? 255 : 0;
    }
  }
  const initials = name
      .split(/\s+/)
      .map((x) => x[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
    scale = 18,
    total = initials.length * 6 * scale - scale,
    start = Math.floor((w - total) / 2),
    top = 83;
  for (let i = 0; i < initials.length; i++) {
    const g = glyphs[initials[i]] ?? glyphs.C;
    for (let gy = 0; gy < 5; gy++)
      for (let gx = 0; gx < 5; gx++)
        if (g[gy][gx] === "1")
          for (let yy = 0; yy < scale; yy++)
            for (let xx = 0; xx < scale; xx++) {
              const x = start + i * 6 * scale + gx * scale + xx,
                y = top + gy * scale + yy,
                o = y * row + 1 + x * 4;
              raw[o] = 255;
              raw[o + 1] = 247;
              raw[o + 2] = 220;
              raw[o + 3] = 255;
            }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
const field = (
  id: string,
  label: string,
  value: string | number,
  group?: string,
) => ({ id, label, value, ...(group ? { group } : {}) });
function document(c: Creature): ThingDocument {
  const abilities = ["STR", "DEX", "CON", "INT", "WIS", "CHA"],
    statBlock: StatBlock = {
      version: 1,
      system: "D&D 5e (2014 SRD)",
      source: "System Reference Document 5.1, CC BY 4.0",
      resources: [{ id: "hp", label: "Hit Points", value: c.hp, max: c.hp }],
      fields: [
        field("type", "Type", c.type),
        field("ac", "Armor Class", c.ac),
        field("hit-dice", "Hit Dice", c.hitDice),
        field("speed", "Speed", c.speed),
        ...abilities.map((a, i) =>
          field(a.toLowerCase(), a, c.abilities[i], "Ability Scores"),
        ),
        ...Object.entries(c.details ?? {}).map(([k, v]) =>
          field(k.toLowerCase().replace(/[^a-z0-9]+/g, "-"), k, v),
        ),
        field("challenge", "Challenge", c.challenge),
      ],
      sections: [
        ...(c.traits?.length
          ? [
              {
                id: "traits",
                name: "Traits",
                entries: c.traits.map(([name, text], i) => ({
                  id: `trait-${i + 1}`,
                  name,
                  text,
                })),
              },
            ]
          : []),
        {
          id: "actions",
          name: "Actions",
          entries: c.actions.map(([name, text], i) => ({
            id: `action-${i + 1}`,
            name,
            text,
          })),
        },
        ...(c.reactions?.length
          ? [
              {
                id: "reactions",
                name: "Reactions",
                entries: c.reactions.map(([name, text], i) => ({
                  id: `reaction-${i + 1}`,
                  name,
                  text,
                })),
              },
            ]
          : []),
      ],
    };
  const mediaId = `token-${c.id}`;
  return ThingDocumentSchema.parse({
    schemaVersion: 2,
    thing: {
      id: c.id,
      name: c.name,
      description: `Reusable ${c.name.toLowerCase()} creature template from the 5.1 SRD.`,
      kind: "creature",
      tags: ["creature", "srd", "dnd5e"],
      face: {
        visual: {
          mode: "token",
          assetId: mediaId,
          width: 1,
          height: 1,
          anchor: [0.5, 0.5],
          footprint: [1, 1],
        },
        media: {
          token: {
            kind: "embedded",
            mediaId,
            type: "image",
            mimeType: "image/png",
          },
        },
      },
      statBlock,
      page: {
        width: 12,
        depth: 10,
        zones: [],
        doors: [],
        anchors: [{ id: "entrance", name: "Entrance", position: [0, 0, 0] }],
        placements: [],
      },
    },
  });
}
await mkdir("world/srd", { recursive: true });
for (const c of creatures) {
  const doc = document(c),
    bytes = token(c.name, c.color),
    mediaId = `token-${c.id}`,
    media = new Map<string, EmbeddedMedia>([
      [mediaId, { id: mediaId, mimeType: "image/png", bytes }],
    ]);
  await writeFile(
    `world/srd/${c.id}.glb`,
    new Uint8Array(await exportThingGlb(doc, media)),
  );
}
console.log(`Wrote ${creatures.length} SRD creature Things.`);
