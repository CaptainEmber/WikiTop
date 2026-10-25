import { test, expect, type BrowserContext, type Page } from "@playwright/test";
async function login(page: Page, name: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: `Continue as ${name}`, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "My Content", exact: true }),
  ).toBeVisible();
}
async function enter(page: Page) {
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page
    .getByRole("button", { name: "Enter →", exact: true })
    .first()
    .click();
  await expect(
    page.locator('.play-workspace[data-connection-status="Live"]'),
  ).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
}
async function selectCharacter(page: Page, id: string) {
  const lib = (await request(page, "/api/library")).data;
  const character = lib.characters.find((c: any) => c.id === id);
  // These scenarios intentionally bring one character; selection is now additive.
  for (const checkbox of await page
    .getByRole("checkbox", { name: /^Current character / })
    .all())
    await checkbox.uncheck();
  await page
    .getByRole("checkbox", {
      name: `Current character ${character.name}`,
      exact: true,
    })
    .check();
  await page
    .getByRole("button", {
      name: `Select character ${character.name}`,
      exact: true,
    })
    .click();
}
async function saveDraft(page: Page) {
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByLabel("Save status", { exact: true })).toHaveText(
    "Saved",
  );
}
async function request(page: Page, path: string, method = "GET", body?: any) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const r = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, data: await r.json() };
    },
    { path, method, body },
  );
}
test("two players share positions, chat, view changes, and travel", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    mara = await a.newPage(),
    rowan = await b.newPage();
  const errors: string[] = [];
  mara.on("pageerror", (e) => errors.push(e.message));
  rowan.on("pageerror", (e) => errors.push(e.message));
  await login(mara, "Mara");
  await login(rowan, "Rowan");
  await enter(mara);
  await enter(rowan);
  if (process.env.SCREENSHOT_DIR)
    await mara.screenshot({
      path: `${process.env.SCREENSHOT_DIR}/wikitop-play.png`,
      fullPage: true,
    });
  await expect(mara.getByText("◉ Rowan")).toBeVisible();
  await expect(rowan.getByText("◉ Mara")).toBeVisible();
  await rowan.getByRole("button", { name: "3D Scene", exact: true }).click();
  await expect(rowan.locator("canvas")).toBeVisible();
  await mara.getByLabel("Chat message").fill("Welcome to our tavern");
  await mara.getByRole("button", { name: "Send as Mara" }).click();
  await expect(rowan.getByText("Welcome to our tavern")).toBeVisible();
  const initial = await request(mara, "/api/library");
  const session = initial.data.sessions[0],
    character = initial.data.characters[0];
  const before = await request(
    mara,
    `/api/sessions/${session.id}/snapshot/${character.id}`,
  );
  const canvas = mara.locator("canvas");
  const box = await canvas.boundingBox();
  await canvas.click({
    button: "right",
    position: { x: box!.width * 0.48, y: box!.height * 0.64 },
  });
  await expect
    .poll(async () => {
      const current = await request(
        mara,
        `/api/sessions/${session.id}/snapshot/${character.id}`,
      );
      return current.data.placement.revision;
    })
    .toBeGreaterThan(before.data.placement.revision);
  await rowan
    .getByRole("button", { name: "Stairs to Basement", exact: true })
    .click();
  await rowan.getByRole("button", { name: "Travel through →" }).click();
  await expect(
    rowan
      .getByRole("heading", { name: "The Stone Basement", exact: true })
      .first(),
  ).toBeVisible();
  await expect(mara.getByText("◉ Rowan")).not.toBeVisible();
  await expect(rowan.getByText("Welcome to our tavern")).not.toBeVisible();
  await rowan.reload();
  await enter(rowan);
  await expect(
    rowan
      .getByRole("heading", { name: "The Stone Basement", exact: true })
      .first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});
test("authors connect new areas without receiving source edit rights", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    mara = await a.newPage(),
    rowan = await b.newPage();
  await login(mara, "Mara");
  await login(rowan, "Rowan");
  const source = (
    await request(mara, "/api/areas", "POST", { name: "Garden Gate" })
  ).data;
  const target = (
    await request(rowan, "/api/areas", "POST", { name: "Rowan’s Garden" })
  ).data;
  const draft = (await request(mara, `/api/areas/${source.id}/draft`)).data;
  draft.scene.doors.push({
    id: "garden-door",
    name: "Garden Door",
    position: [1, 0, 0],
  });
  expect(
    (
      await request(mara, `/api/areas/${source.id}/scene`, "PUT", {
        revision: 0,
        scene: draft.scene,
      })
    ).status,
  ).toBe(200);
  const inv = (
    await request(mara, "/api/invitations", "POST", {
      sourceAreaId: source.id,
      doorId: "garden-door",
      recipientId: "rowan",
    })
  ).data;
  expect((await request(rowan, `/api/areas/${source.id}/draft`)).status).toBe(
    403,
  );
  expect(
    (
      await request(rowan, `/api/invitations/${inv.id}/propose`, "POST", {
        targetAreaId: target.id,
        anchorId: "entrance",
      })
    ).status,
  ).toBe(200);
  expect(
    (await request(mara, `/api/invitations/${inv.id}/accept`, "POST")).status,
  ).toBe(200);
  await request(mara, `/api/areas/${source.id}/publish`, "POST");
  await request(rowan, `/api/areas/${target.id}/publish`, "POST");
  await mara.reload();
  await mara.getByRole("button", { name: "Open editor ↗" }).last().click();
  await expect(
    mara.getByRole("heading", { name: "Garden Gate", exact: true }).first(),
  ).toBeVisible();
  await expect(
    mara.getByRole("button", { name: "Garden Door", exact: true }),
  ).toBeVisible();
  await a.close();
  await b.close();
});
test("scene editor saves image cards and publishes while active sessions remain pinned", async ({
  page,
}) => {
  await login(page, "Mara");
  const lib = (await request(page, "/api/library")).data,
    tavern = lib.areas.find((a: any) => a.name === "Emberheart Tavern"),
    session = lib.sessions[0],
    oldPin = session.pins[tavern.id];
  await page.getByRole("button", { name: "Open editor ↗" }).first().click();
  await expect(page.locator("canvas")).toBeVisible();
  await page
    .getByRole("button", { name: "＋ Standing card", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("A mysterious letter");
  await saveDraft(page);
  await page
    .getByRole("button", { name: "Publish snapshot", exact: true })
    .click();
  await expect(page.locator(".notice")).toContainText("Published");
  const next = (await request(page, "/api/library")).data;
  expect(next.sessions[0].pins[tavern.id]).toBe(oldPin);
  expect(
    next.areas.find((a: any) => a.id === tavern.id).latestPublicationId,
  ).not.toBe(oldPin);
});

test("edits XYZ with Z as elevation and draws zones in the XY map plane", async ({
  page,
}) => {
  await login(page, "Mara");
  await page.getByRole("button", { name: "Open editor ↗" }).first().click();
  await page.getByRole("button", { name: "Flask", exact: true }).click();
  await page.getByLabel("X", { exact: true }).fill("1");
  await page.getByLabel("Y", { exact: true }).fill("2");
  await page.getByLabel("Z", { exact: true }).fill("3");
  await saveDraft(page);
  const lib = (await request(page, "/api/library")).data,
    area = lib.areas.find((a: any) => a.name === "Emberheart Tavern");
  let draft = (await request(page, `/api/areas/${area.id}/draft`)).data;
  expect(draft.scene.schemaVersion).toBe(2);
  expect(
    draft.scene.things.find((t: any) => t.id === "flask").position,
  ).toEqual([1, 2, 3]);
  await page
    .getByRole("button", { name: "＋ Draw rectangular zone", exact: true })
    .click();
  const box = await page.locator("canvas").boundingBox();
  await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width * 0.4,
    box!.y + box!.height * 0.45,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "New zone",
  );
  await expect(page.getByLabel("Zone y", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Z", { exact: true })).toHaveCount(0);
  await saveDraft(page);
  draft = (await request(page, `/api/areas/${area.id}/draft`)).data;
  const zone = draft.scene.zones.at(-1);
  expect(zone).toHaveProperty("y");
  expect(zone).not.toHaveProperty("z");
  await page.getByRole("button", { name: "3D Scene", exact: true }).click();
  if (process.env.SCREENSHOT_DIR)
    await page.screenshot({
      path: `${process.env.SCREENSHOT_DIR}/wikitop-z-up-3d.png`,
      fullPage: true,
    });
});

test("selection, controlled right-click movement, inventory and full art work across browsers", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const host = await a.newPage(),
    player = await b.newPage();
  await login(host, "Mara");
  await login(player, "Lyra");
  const library = (await request(host, "/api/library")).data;
  const tavern = library.areas.find((a: any) => a.name === "Emberheart Tavern");
  const session = (
    await request(host, "/api/sessions", "POST", {
      name: "Interaction checks",
      areaIds: [tavern.id],
    })
  ).data;
  await request(host, `/api/sessions/${session.id}/invite`, "POST", {
    recipientId: "lyra",
  });
  const owner = (
    await request(host, "/api/characters", "POST", {
      name: "Mara Operator",
      assetId: "sample_token",
      imageAssetId: "sample_card",
      description: "The selected character description",
    })
  ).data;
  const guest = (
    await request(player, "/api/characters", "POST", {
      name: "Lyra Operator",
      assetId: "sample_token",
    })
  ).data;
  async function join(page: Page, id: string) {
    await page.reload();
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
    await selectCharacter(page, id);
    await page
      .locator(".session")
      .filter({ hasText: "Interaction checks" })
      .getByRole("button", { name: "Enter →", exact: true })
      .click();
    await expect(
      page.locator('.play-workspace[data-connection-status="Live"]'),
    ).toBeVisible();
  }
  await join(host, owner.id);
  await join(player, guest.id);
  const snapshot = (page: Page, id: string) =>
    request(page, `/api/sessions/${session.id}/snapshot/${id}`);
  const canvas = host.locator("canvas"),
    box = (await canvas.boundingBox())!;
  const before = (await snapshot(host, owner.id)).data;
  // Left-clicking a token selects it without changing position.
  await canvas.click({
    position: { x: box.width / 2 - 3 * 26, y: box.height / 2 },
  });
  await expect(
    host.getByRole("heading", { name: "Flask", exact: true }),
  ).toBeVisible();
  expect((await snapshot(host, owner.id)).data.placement.position).toEqual(
    before.placement.position,
  );
  await host.getByLabel("Assign controller").selectOption("lyra");
  await expect
    .poll(async () => (await snapshot(player, guest.id)).data.controllableIds)
    .toContain("flask");
  await player.getByRole("button", { name: "Flask", exact: true }).click();
  const playerCanvas = player.locator("canvas"),
    playerBox = (await playerCanvas.boundingBox())!;
  await playerCanvas.click({
    button: "right",
    position: { x: playerBox.width * 0.65, y: playerBox.height * 0.6 },
  });
  await expect
    .poll(
      async () =>
        (await snapshot(host, owner.id)).data.scene.things.find(
          (t: any) => t.id === "flask",
        ).position,
    )
    .not.toEqual([-3, 0, 0]);
  await player.getByRole("button", { name: "3D Scene", exact: true }).click();
  await host.getByRole("button", { name: "Take", exact: true }).click();
  await expect(
    player.getByRole("button", { name: "Flask", exact: true }),
  ).not.toBeVisible();
  await host
    .getByRole("button", { name: "◉ Mara Operator · you", exact: true })
    .click();
  await expect(
    host.getByText("The selected character description"),
  ).toBeVisible();
  await expect(host.getByRole("img", { name: "Full artwork" })).toBeVisible();
  await host
    .getByRole("button", { name: "Enter yourself", exact: true })
    .click();
  await expect(
    host
      .getByRole("navigation", { name: "Viewed space" })
      .getByRole("button", { name: "Mara Operator", exact: true }),
  ).toBeVisible();
  await host.getByRole("button", { name: "Flask", exact: true }).click();
  await host
    .getByRole("checkbox", { name: "Visible to others", exact: true })
    .check();
  await expect(
    host.getByRole("checkbox", { name: "Visible to others", exact: true }),
  ).toBeChecked();
  await host
    .getByRole("button", { name: "Drop in Emberheart Tavern", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await snapshot(player, guest.id)).data.scene.things.some(
        (t: any) => t.name === "Flask",
      ),
    )
    .toBe(true);
  await player
    .getByRole("button", { name: "◉ Mara Operator", exact: true })
    .click();
  await player
    .getByRole("button", { name: "Peer inside", exact: true })
    .click();
  await expect(
    player
      .getByRole("navigation", { name: "Viewed space" })
      .getByRole("button", { name: "Mara Operator", exact: true }),
  ).toBeVisible();
  await expect(
    player.getByRole("button", {
      name: "Drop in Emberheart Tavern",
      exact: true,
    }),
  ).not.toBeVisible();
  await a.close();
  await b.close();
});

test("the wiki opens editable articles, characters can be renamed, and maps are Backgrounds", async ({
  page,
}) => {
  await login(page, "Mara");
  const area = (
    await request(page, "/api/areas", "POST", { name: "Editable wiki article" })
  ).data;
  const character = (
    await request(page, "/api/characters", "POST", {
      name: "Editable explorer",
      assetId: "sample_token",
    })
  ).data;
  await page.reload();
  const wikiPromise = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Wiki ↗", exact: true }).click();
  const wiki = await wikiPromise;
  await wiki
    .getByRole("heading", { name: "Your wiki articles", exact: true })
    .waitFor();
  await wiki
    .getByRole("link", { name: "Editable wiki article", exact: true })
    .click();
  await wiki
    .getByLabel("Article content")
    .fill("# An edited article\n\nWritten through the wiki link.");
  await wiki.getByRole("button", { name: "Save article", exact: true }).click();
  await expect(wiki.getByLabel("Article content")).toHaveValue(
    "# An edited article\n\nWritten through the wiki link.",
  );
  await wiki.close();
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await page
    .getByRole("button", {
      name: `Edit character ${character.name}`,
      exact: true,
    })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Renamed explorer");
  await page
    .getByLabel("Description", { exact: true })
    .fill("An editable character.");
  await saveDraft(page);
  const saved = (await request(page, "/api/library")).data.characters.find(
    (c: any) => c.id === character.id,
  );
  expect(saved.name).toBe("Renamed explorer");
  expect(saved.description).toBe("An editable character.");
  await page.getByRole("button", { name: "My Content", exact: true }).click();
  await page
    .locator(".area-card")
    .filter({ hasText: "Editable wiki article" })
    .getByRole("button", { name: "Open editor ↗", exact: true })
    .click();
  await page
    .getByRole("button", { name: "＋ Background", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Background",
  );
  await saveDraft(page);
  const draft = (await request(page, `/api/areas/${area.id}/draft`)).data;
  expect(
    draft.scene.things.some(
      (t: any) => t.name === "Background" && t.visual.mode === "map",
    ),
  ).toBe(true);
});

test("interior views stay separate from location, synchronize items, and return to the character", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    c = await browser.newContext();
  const host = await a.newPage(),
    guest = await b.newPage(),
    remote = await c.newPage();
  const errors: string[] = [];
  for (const p of [host, guest, remote])
    p.on("pageerror", (e) => errors.push(e.message));
  await login(host, "Mara");
  await login(guest, "Rowan");
  await login(remote, "Mara");
  const library = (await request(host, "/api/library")).data,
    tavern = library.areas.find((a: any) => a.name === "Emberheart Tavern");
  const session = (
    await request(host, "/api/sessions", "POST", {
      name: "Interior navigation checks",
      areaIds: [tavern.id],
    })
  ).data;
  await request(host, `/api/sessions/${session.id}/invite`, "POST", {
    recipientId: "rowan",
  });
  const owner = (
    await request(host, "/api/characters", "POST", {
      name: "View explorer",
      assetId: "sample_token",
      imageAssetId: "sample_card",
    })
  ).data;
  const witness = (
    await request(guest, "/api/characters", "POST", {
      name: "View witness",
      assetId: "sample_token",
    })
  ).data;
  const thing = (id: string, extra: any = {}) => ({
    id,
    name: id,
    description: id + " description",
    role: "inventory",
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    children: [],
    portable: true,
    ...extra,
  });
  expect(
    (
      await request(host, `/api/characters/${owner.id}`, "PATCH", {
        children: [
          thing("Backpack", {
            visible: true,
            peerable: false,
            children: [thing("Sword", { visible: true })],
          }),
          thing("Potion"),
          thing("Torch", { visible: true }),
        ],
      })
    ).status,
  ).toBe(200);
  async function join(page: Page, id: string) {
    await page.reload();
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
    await selectCharacter(page, id);
    await page
      .locator(".session")
      .filter({ hasText: "Interior navigation checks" })
      .getByRole("button", { name: "Enter →", exact: true })
      .click();
    await expect(
      page.locator('.play-workspace[data-connection-status="Live"]'),
    ).toBeVisible();
  }
  await join(host, owner.id);
  await join(guest, witness.id);
  await join(remote, owner.id);
  const snapshot = async (page: Page, id: string) =>
    (await request(page, `/api/sessions/${session.id}/snapshot/${id}`)).data;
  const before = (await snapshot(host, owner.id)).placement;
  await host
    .getByRole("button", { name: "Enter yourself", exact: true })
    .click();
  await expect(
    host
      .getByRole("navigation", { name: "Viewed space" })
      .getByRole("button", { name: "View explorer", exact: true }),
  ).toBeVisible();
  expect((await snapshot(host, owner.id)).placement).toEqual(before);
  await expect(
    host.getByText("Character location: Emberheart Tavern", { exact: true }),
  ).toHaveCount(0);
  expect((await snapshot(host, owner.id)).publication.name).toBe(
    "Emberheart Tavern",
  );
  await expect(
    host.getByRole("button", { name: "Potion", exact: true }),
  ).toBeVisible();
  await host.getByRole("button", { name: "Torch", exact: true }).click();
  const canvas = host.locator("canvas"),
    box = (await canvas.boundingBox())!;
  const torchBefore = (await snapshot(host, owner.id)).inventory.find(
    (t: any) => t.name === "Torch",
  ).position;
  await canvas.click({
    button: "right",
    position: { x: box.width * 0.6, y: box.height * 0.6 },
  });
  await expect
    .poll(
      async () =>
        (await snapshot(host, owner.id)).inventory.find(
          (t: any) => t.name === "Torch",
        ).position,
    )
    .not.toEqual(torchBefore);
  expect((await snapshot(host, owner.id)).placement).toEqual(before);
  await guest
    .getByRole("button", { name: "◉ View explorer", exact: true })
    .click();
  await guest.getByRole("button", { name: "Peer inside", exact: true }).click();
  await expect(
    guest
      .getByRole("navigation", { name: "Viewed space" })
      .getByRole("button", { name: "View explorer", exact: true }),
  ).toBeVisible();
  await expect(
    guest.getByRole("button", { name: "Potion", exact: true }),
  ).not.toBeVisible();
  await guest.getByRole("button", { name: "Backpack", exact: true }).click();
  await expect(
    guest.getByRole("button", { name: "Peer inside", exact: true }),
  ).not.toBeVisible();
  await expect(
    guest.getByRole("button", { name: "Sword", exact: true }),
  ).not.toBeVisible();
  await host.getByRole("button", { name: "Backpack", exact: true }).click();
  await host.getByRole("button", { name: "Peer inside", exact: true }).click();
  await expect(
    host
      .getByRole("navigation", { name: "Viewed space" })
      .getByRole("button", { name: "Backpack", exact: true }),
  ).toBeVisible();
  await expect(
    host.getByRole("button", { name: "Sword", exact: true }),
  ).toBeVisible();
  expect((await snapshot(host, owner.id)).placement).toEqual(before);
  await host
    .getByRole("navigation", { name: "Viewed space" })
    .getByRole("button", { name: "View explorer", exact: true })
    .click();
  await host.getByRole("button", { name: "Backpack", exact: true }).click();
  await host
    .getByRole("checkbox", { name: "Allow peering", exact: true })
    .check();
  await expect(
    host.getByRole("checkbox", { name: "Allow peering", exact: true }),
  ).toBeChecked();
  await guest.getByRole("button", { name: "Peer inside", exact: true }).click();
  await expect(
    guest
      .getByRole("navigation", { name: "Viewed space" })
      .getByRole("button", { name: "Backpack", exact: true }),
  ).toBeVisible();
  await host
    .getByRole("checkbox", { name: "Allow peering", exact: true })
    .uncheck();
  await expect(
    guest
      .getByRole("heading", { name: "Emberheart Tavern", exact: true })
      .first(),
  ).toBeVisible();
  await host
    .getByRole("button", { name: "Return to character", exact: true })
    .click();
  await host.getByLabel("Assign controller").selectOption("rowan");
  await host
    .getByRole("button", { name: "Enter yourself", exact: true })
    .click();
  await guest
    .getByRole("button", { name: "◉ View explorer", exact: true })
    .click();
  await guest.getByRole("button", { name: "Peer inside", exact: true }).click();
  await guest.getByRole("button", { name: "Torch", exact: true }).click();
  await guest.getByRole("button", { name: "3D Scene", exact: true }).click();
  const gbox = (await guest.locator("canvas").boundingBox())!,
    torchCurrent = (await snapshot(host, owner.id)).inventory.find(
      (t: any) => t.name === "Torch",
    ).position;
  await guest.locator("canvas").click({
    button: "right",
    position: { x: gbox.width * 0.6, y: gbox.height * 0.7 },
  });
  await expect
    .poll(
      async () =>
        (await snapshot(host, owner.id)).inventory.find(
          (t: any) => t.name === "Torch",
        ).position,
    )
    .not.toEqual(torchCurrent);
  await b.setOffline(true);
  await b.setOffline(false);
  await expect(
    guest.locator('.play-workspace[data-connection-status="Live"]'),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    guest
      .getByRole("navigation", { name: "Viewed space" })
      .getByRole("button", { name: "View explorer", exact: true }),
  ).toBeVisible();
  await host.getByRole("button", { name: "3D Scene", exact: true }).click();
  if (process.env.SCREENSHOT_DIR)
    await host.screenshot({
      path: `${process.env.SCREENSHOT_DIR}/wikitop-character-interior.png`,
      fullPage: true,
    });
  await remote
    .getByRole("button", { name: "Stairs to Basement", exact: true })
    .click();
  await remote
    .getByRole("button", { name: "Travel through →", exact: true })
    .click();
  await expect(
    host.getByText("Character location: The Stone Basement", { exact: true }),
  ).toHaveCount(0);
  expect((await snapshot(host, owner.id)).publication.name).toBe(
    "The Stone Basement",
  );
  await expect(
    host
      .getByRole("navigation", { name: "Viewed space" })
      .getByRole("button", { name: "View explorer", exact: true }),
  ).toBeVisible();
  await expect(
    guest
      .getByRole("heading", { name: "Emberheart Tavern", exact: true })
      .first(),
  ).toBeVisible();
  const inBasement = (await snapshot(host, owner.id)).placement;
  await host
    .getByRole("button", { name: "Return to character", exact: true })
    .click();
  await expect(
    host
      .getByRole("heading", { name: "The Stone Basement", exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    host.getByRole("button", { name: "Enter yourself", exact: true }),
  ).toBeVisible();
  await expect(
    host.getByRole("button", { name: "3D Scene", exact: true }),
  ).toHaveClass("active");
  expect((await snapshot(host, owner.id)).placement).toEqual(inBasement);
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
  await c.close();
});

test("character interior templates save spatial layout and sharing flags", async ({
  page,
}) => {
  await login(page, "Mara");
  const character = (
    await request(page, "/api/characters", "POST", {
      name: "Layout author",
      assetId: "sample_token",
    })
  ).data;
  await page.reload();
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await page
    .getByRole("button", {
      name: `Edit character ${character.name}`,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Add interior space", exact: true })
    .click();
  await page.getByLabel("Space width", { exact: true }).fill("24");
  await page.getByLabel("Space depth", { exact: true }).fill("18");
  await page.getByRole("button", { name: "＋ Container", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Travel pack");
  await page.getByRole("checkbox", { name: "Visible", exact: true }).check();
  await page.getByRole("button", { name: "Open inside", exact: true }).click();
  await page.getByRole("button", { name: "＋ Thing", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Secret compass");
  await page.getByRole("button", { name: "← Back", exact: true }).click();
  await saveDraft(page);
  const saved = (await request(page, "/api/library")).data.characters.find(
    (c: any) => c.id === character.id,
  );
  expect(saved.space).toMatchObject({ width: 24, depth: 18 });
  expect(saved.children[0]).toMatchObject({
    name: "Travel pack",
    visible: true,
    peerable: false,
  });
  expect(saved.children[0].children[0].name).toBe("Secret compass");
});

test("library tabs separate owned articles and save filterable tags", async ({
  page,
}) => {
  await login(page, "Mara");
  const library = (await request(page, "/api/library")).data;
  const own = library.areas.filter(
    (a: any) => a.ownerId === library.account.id,
  );
  await expect(page.locator(".area-card")).toHaveCount(own.length);
  const card = page.locator(".area-card").first();
  await card.getByText("Edit tags", { exact: true }).click();
  await card.getByRole("button", { name: "+ setting", exact: true }).click();
  await card.getByLabel("Add tags", { exact: true }).fill("tavern");
  await card.getByRole("button", { name: "Add tag", exact: true }).click();
  await card.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Tags saved");
  await page.getByLabel("Filter by tag").selectOption("tavern");
  await expect(page.locator(".area-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Shared with Me", exact: true })
    .click();
  await page.getByLabel("Filter by tag").selectOption("");
  await expect(page.locator(".area-card")).toHaveCount(
    library.areas.length - own.length,
  );
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Connections", exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Select character / }).first(),
  ).toBeVisible();
});

test("article exit links browse destinations without physical travel", async ({
  page,
  context,
}) => {
  await login(page, "Mara");
  const library = (await request(page, "/api/library")).data;
  const source = library.areas.find(
    (a: any) => a.ownerId === library.account.id,
  );
  const article = (await request(page, `/api/areas/${source.id}/article`)).data;
  const linked = article.exits.find((e: any) => e.targetAreaId);
  expect(linked).toBeTruthy();
  const before = (await request(page, "/api/library")).data.sessions;
  const reader = await context.newPage();
  await reader.goto(`/articles/${source.id}`);
  await expect(
    reader.getByRole("heading", { name: "Exits", exact: true }),
  ).toBeVisible();
  await reader
    .getByRole("link", { name: linked.destinationName, exact: true })
    .click();
  await expect(
    reader
      .getByRole("heading", { name: linked.destinationName, exact: true })
      .first(),
  ).toBeVisible();
  expect((await request(page, "/api/library")).data.sessions).toEqual(before);
  await reader.close();
  await enter(page);
  await expect(
    page.getByRole("button", {
      name: `Travel via ${linked.name} →`,
      exact: true,
    }),
  ).toBeVisible();
  const browse = context.waitForEvent("page");
  await page
    .locator(".exit-catalog")
    .getByRole("link", { name: `${linked.destinationName} ↗`, exact: true })
    .click();
  const sessionReader = await browse;
  await expect(
    sessionReader
      .getByRole("heading", {
        name: linked.destinationName,
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: article.name, exact: true }).first(),
  ).toBeVisible();
  await sessionReader.close();
});

test("broken exits support owner creation, permission requests, and invitation links", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext(),
    guestContext = await browser.newContext();
  const owner = await ownerContext.newPage(),
    guest = await guestContext.newPage();
  await login(owner, "Mara");
  await login(guest, "Lyra");
  const source = (
    await request(owner, "/api/areas", "POST", { name: "Unwritten frontiers" })
  ).data;
  const draft = (await request(owner, `/api/areas/${source.id}/draft`)).data;
  draft.scene.doors = [
    { id: "own_door", name: "Owner door", position: [0, 0, 0] },
    { id: "request_door", name: "Requested door", position: [1, 0, 0] },
    { id: "link_door", name: "Invited door", position: [2, 0, 0] },
  ];
  expect(
    (
      await request(owner, `/api/areas/${source.id}/scene`, "PUT", {
        revision: draft.area.sceneRevision,
        scene: draft.scene,
      })
    ).status,
  ).toBe(200);
  await request(owner, `/api/areas/${source.id}/publish`, "POST");
  await request(owner, `/api/areas/${source.id}/share`, "POST", {
    recipientId: "lyra",
  });
  await owner.goto(`/articles/${source.id}`);
  const ownDoor = owner
    .locator(".exit-catalog li")
    .filter({ hasText: "Owner door" });
  await ownDoor.getByLabel("Destination name").fill("Owner garden");
  await ownDoor
    .getByRole("button", {
      name: "Create destination article / Thing",
      exact: true,
    })
    .click();
  await expect(
    ownDoor.getByRole("link", {
      name: "Edit destination article / Thing ↗",
      exact: true,
    }),
  ).toBeVisible();
  await guest.goto(`/articles/${source.id}`);
  const requestDoor = guest
    .locator(".exit-catalog li")
    .filter({ hasText: "Requested door" });
  await requestDoor
    .getByRole("button", { name: "Request permission to create", exact: true })
    .click();
  await expect(requestDoor.getByRole("status")).toContainText("Request sent");
  await owner.goto("/");
  await owner.getByRole("button", { name: "Connections", exact: true }).click();
  const pending = owner
    .locator(".invitation")
    .filter({ hasText: "request_door" });
  await pending
    .getByRole("button", { name: "Approve creation request", exact: true })
    .click();
  await expect(pending.locator(".badge")).toHaveText("pending");
  await guest.goto("/");
  await guest.getByRole("button", { name: "Connections", exact: true }).click();
  const approved = guest
    .locator(".invitation")
    .filter({ hasText: "request_door" });
  await approved.getByLabel("Destination name").fill("Guest garden");
  await approved
    .getByRole("button", {
      name: "Create destination article / Thing",
      exact: true,
    })
    .click();
  await expect(
    approved.getByRole("link", {
      name: "Edit destination article / Thing ↗",
      exact: true,
    }),
  ).toBeVisible();
  expect((await request(guest, `/api/areas/${source.id}/draft`)).status).toBe(
    403,
  );
  await owner.goto(`/articles/${source.id}`);
  const linkDoor = owner
    .locator(".exit-catalog li")
    .filter({ hasText: "Invited door" });
  await linkDoor
    .getByRole("button", { name: "Generate invitation link", exact: true })
    .click();
  await expect(
    linkDoor.getByLabel("Invitation link", { exact: true }),
  ).toBeVisible();
  const url = await linkDoor
    .getByLabel("Invitation link", { exact: true })
    .inputValue();
  await guest.goto(url);
  await guest
    .getByRole("button", { name: "Claim invitation", exact: true })
    .click();
  await guest.getByLabel("Destination name").fill("Invitation garden");
  await guest
    .getByRole("button", {
      name: "Create destination article / Thing",
      exact: true,
    })
    .click();
  await expect(
    guest.getByRole("link", {
      name: "Edit destination article / Thing ↗",
      exact: true,
    }),
  ).toBeVisible();
  await ownerContext.close();
  await guestContext.close();
});

test("saved doors immediately offer destination creation in the editor", async ({
  page,
}) => {
  await login(page, "Mara");
  const source = (
    await request(page, "/api/areas", "POST", { name: "Editor frontier" })
  ).data;
  await page.goto(`/?editArea=${source.id}`);
  await page.getByRole("button", { name: "＋ Door", exact: true }).click();
  await saveDraft(page);
  await page.getByLabel("Destination name").fill("Beyond the editor");
  await page
    .getByRole("button", {
      name: "Create destination article / Thing",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("link", {
      name: "Edit destination article / Thing ↗",
      exact: true,
    }),
  ).toBeVisible();
});
