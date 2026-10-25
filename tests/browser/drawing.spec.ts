import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, name: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: `Continue as ${name}`, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "My Content", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page
    .getByRole("button", { name: "Enter →", exact: true })
    .first()
    .click();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Draw", exact: true }),
  ).toBeVisible();
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const lib = await (await fetch("/api/library")).json();
    return await (
      await fetch(
        `/api/sessions/${lib.sessions[0].id}/snapshot/${lib.characters[0].id}`,
      )
    ).json();
  });
}
async function draw(page: Page, observer?: Page) {
  const b = (await page.locator("canvas").boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.62);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.67, {
    steps: 16,
  });
  if (observer)
    await expect(observer.getByText("✎ Mara", { exact: true })).toBeVisible();
  await page.mouse.up();
}
test("two camera views share ink, owner saves to draft, and reload restores drawings", async ({
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
  await expect(
    rowan.getByRole("button", { name: "Draw", exact: true }),
  ).toBeDisabled();
  await mara.getByRole("checkbox", { name: "Enable shared drawing" }).click();
  await expect(
    rowan.getByRole("button", { name: "Draw", exact: true }),
  ).toBeEnabled();
  const before = await snapshot(mara),
    count = before.view.drawing.drawing.strokes.length;
  await mara.getByRole("button", { name: "Draw", exact: true }).click();
  await draw(mara, rowan);
  await mara.screenshot({ path: "/tmp/wikitop-shared-drawing.png" });
  await expect
    .poll(
      async () => (await snapshot(rowan)).view.drawing.drawing.strokes.length,
    )
    .toBe(count + 1);
  await rowan.getByRole("button", { name: "3D Scene", exact: true }).click();
  await rowan.getByRole("button", { name: "Draw", exact: true }).click();
  await draw(rowan);
  await expect
    .poll(
      async () => (await snapshot(mara)).view.drawing.drawing.strokes.length,
    )
    .toBe(count + 2);
  expect((await snapshot(mara)).placement).toEqual(before.placement);
  await rowan
    .getByRole("button", { name: "Undo drawing", exact: true })
    .click();
  await expect
    .poll(
      async () => (await snapshot(mara)).view.drawing.drawing.strokes.length,
    )
    .toBe(count + 1);
  await rowan
    .getByRole("button", { name: "Redo drawing", exact: true })
    .click();
  await expect
    .poll(
      async () => (await snapshot(mara)).view.drawing.drawing.strokes.length,
    )
    .toBe(count + 2);
  await mara
    .getByRole("button", { name: "Save drawing to draft", exact: true })
    .click();
  await expect(mara.getByRole("status")).toContainText(
    "Saved drawing revision",
  );
  const after = await snapshot(mara);
  expect(after.view.drawing.dirty).toBe(false);
  expect(after.publication).toEqual(before.publication);
  const doc = await mara.evaluate(
    async (id) => await (await fetch(`/api/things/${id}/document`)).json(),
    after.placement.areaId,
  );
  expect(
    doc.document.nodes[after.placement.areaId].space.drawing.strokes.length,
  ).toBe(count + 2);
  await rowan.reload();
  await rowan.getByRole("button", { name: "Sessions", exact: true }).click();
  await rowan
    .getByRole("button", { name: "Enter →", exact: true })
    .first()
    .click();
  await expect(
    rowan.getByRole("button", { name: "Draw", exact: true }),
  ).toBeEnabled();
  expect((await snapshot(rowan)).view.drawing.drawing.strokes.length).toBe(
    count + 2,
  );
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});

test("blank spaces allow drawing beyond map edges and after panning far away", async ({
  page,
}) => {
  await login(page, "Mara");
  const created = await page.evaluate(async () => {
    const post = async (path: string, body?: unknown) => {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!r.ok) throw Error(await r.text());
      return r.json();
    };
    const area = await post("/api/areas", { name: "Unbounded blank drawing" });
    await post(`/api/areas/${area.id}/publish`);
    const session = await post("/api/sessions", {
      name: "Blank drawing checks",
      areaIds: [area.id],
    });
    const character = await post("/api/characters", {
      name: "Blank canvas artist",
    });
    return { area, session, character };
  });
  await page.reload();
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  for (const cb of await page
    .getByRole("checkbox", { name: /^Current character / })
    .all())
    await cb.uncheck();
  await page
    .getByRole("button", {
      name: "Select character Blank canvas artist",
      exact: true,
    })
    .click();
  await page
    .locator(".session")
    .filter({ hasText: "Blank drawing checks" })
    .getByRole("button", { name: "Enter →", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Draw", exact: true }),
  ).toBeVisible();
  const snap = () =>
    page.evaluate(
      async ({ session, character }) =>
        await (
          await fetch(`/api/sessions/${session.id}/snapshot/${character.id}`)
        ).json(),
      created,
    );
  const before = await snap();
  expect(before.view.backgroundAssetId).toBeUndefined();
  expect(before.view.scene.things).toHaveLength(0);
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  const box = (await page.locator("canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.93, box.y + box.height * 0.65);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.98, box.y + box.height * 0.7, {
    steps: 10,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await snap()).view.drawing.drawing.strokes.length)
    .toBe(1);
  const first = (await snap()).view.drawing.drawing.strokes[0];
  expect(
    first.points.some(
      ([x, y]: number[]) =>
        Math.abs(x) > before.view.scene.width / 2 ||
        Math.abs(y) > before.view.scene.depth / 2,
    ),
  ).toBe(true);
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.65);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.65, {
      steps: 5,
    });
    await page.mouse.up({ button: "middle" });
  }
  await draw(page);
  await expect
    .poll(async () => (await snap()).view.drawing.drawing.strokes.length)
    .toBe(2);
  const far = (await snap()).view.drawing.drawing.strokes[1];
  expect(
    far.points.some(
      ([x, y]: number[]) => Math.abs(x) > 100 || Math.abs(y) > 100,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/wikitop-extended-drawing.png" });
  await page
    .getByRole("button", { name: "Save drawing to draft", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Saved drawing revision",
  );
  const after = await snap();
  expect(after.placement).toEqual(before.placement);
  expect(after.view.scene.width).toBe(before.view.scene.width);
});
