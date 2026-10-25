import { emptyScene, type Account, type AreaScene } from "@wikitop/shared";
import type { World } from "./world.js";
export const demoAccounts: Account[] = [
  {
    id: "mara",
    issuer: "dev",
    subject: "mara",
    name: "Mara",
    email: "mara@example.test",
  },
  {
    id: "rowan",
    issuer: "dev",
    subject: "rowan",
    name: "Rowan",
    email: "rowan@example.test",
  },
  {
    id: "lyra",
    issuer: "dev",
    subject: "lyra",
    name: "Lyra",
    email: "lyra@example.test",
  },
];
export async function seedDemo(world: World, accounts = demoAccounts) {
  const existing = await world.store.read();
  if (Object.values(existing.areas).length) return;
  await world.store.transaction((s) => {
    for (const a of accounts) s.accounts[a.id] = a;
  });
  const [mara, rowan] = accounts;
  const tavern = await world.createArea(mara.id, "Emberheart Tavern"),
    basement = await world.createArea(rowan.id, "The Stone Basement");
  const t: AreaScene = {
    ...emptyScene(),
    things: [
      {
        id: "floor",
        name: "Tavern floor",
        description: "A well-worn timber floor.",
        role: "spatial",
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
        visual: {
          mode: "map",
          assetId: "sample_map",
          width: 20,
          height: 16,
          anchor: [0.5, 0.5],
          footprint: [20, 16],
        },
        children: [],
      },
      {
        id: "flask",
        portable: true,
        imageAssetId: "sample_card",
        name: "Flask",
        description: "An enamel flask beside the hearth.",
        role: "spatial",
        position: [-3, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
        visual: {
          mode: "billboard",
          assetId: "sample_card",
          width: 1.2,
          height: 1.8,
          anchor: [0.5, 0],
          footprint: [1, 1],
        },
        children: [],
      },
      {
        id: "sample_crystal",
        name: "Hearth crystal",
        description: "A bundled GLB model.",
        role: "spatial",
        position: [3, 2, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
        visual: {
          mode: "model",
          assetId: "sample_model",
          width: 1,
          height: 1,
          anchor: [0.5, 0],
          footprint: [1, 1],
        },
        children: [],
      },
    ],
    zones: [
      {
        id: "bar",
        name: "Bar",
        x: -5,
        y: 4,
        width: 8,
        depth: 4,
        priority: 10,
      },
      {
        id: "hearth",
        name: "Hearth",
        x: 4,
        y: 0,
        width: 6,
        depth: 6,
        priority: 5,
      },
    ],
    doors: [{ id: "stairs", name: "Stairs to Basement", position: [7, 5, 0] }],
  };
  await world.saveScene(mara.id, tavern.id, 0, t);
  await world.saveScene(rowan.id, basement.id, 0, {
    ...emptyScene(),
    doors: [
      { id: "upstairs", name: "Back to the Tavern", position: [0, 5, 0] },
    ],
    zones: [
      {
        id: "cellar",
        name: "Cellar",
        x: 0,
        y: 0,
        width: 10,
        depth: 10,
        priority: 1,
      },
    ],
  });
  await world.wiki.writeArticle(
    tavern.articleId,
    "# Emberheart Tavern\n\nRain taps against the windows. A warm hearth lights the timber walls, and a flask waits on a nearby table.\n\nMara built this refuge. Rowan has offered to create what lies below the stairs.",
  );
  await world.wiki.writeArticle(
    basement.articleId,
    "# The Stone Basement\n\nYou are in a dark stone room. The air smells of rain, oak barrels, and old stories.",
  );
  const invitation = await world.inviteConnection(
    mara.id,
    tavern.id,
    "stairs",
    rowan.id,
  );
  await world.propose(rowan.id, invitation.id, basement.id, "entrance");
  await world.accept(mara.id, invitation.id);
  const back = await world.inviteConnection(
    rowan.id,
    basement.id,
    "upstairs",
    mara.id,
  );
  await world.propose(mara.id, back.id, tavern.id, "entrance");
  await world.accept(rowan.id, back.id);
  await world.publish(mara.id, tavern.id);
  await world.publish(rowan.id, basement.id);
  const session = await world.createSession(
    mara.id,
    "An evening at Emberheart",
    [tavern.id, basement.id],
  );
  for (const a of accounts) {
    if (a.id !== mara.id) await world.invitePlayer(mara.id, session.id, a.id);
    const character = await world.createCharacter(
      a.id,
      a.name,
      "sample_token",
      undefined,
      "A traveler making stories with friends.",
    );
    await world.updateCharacter(a.id, character.id, {
      imageAssetId: "sample_token",
      children: [
        {
          id: `notes_${a.id}`,
          name: "Notes",
          description: "An example custom attribute; no rules are enforced.",
          role: "attribute",
          value: "Ready for adventure",
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
          children: [],
        },
      ],
    });
  }
}
