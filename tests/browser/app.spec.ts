import { test, expect } from "@playwright/test";
test("browses, edits, follows links, autosaves, and exports", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Published world" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Emberheart Tavern/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Emberheart Tavern",
      exact: true,
      level: 2,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit local copy" }).click();
  await page.getByLabel("Name").fill("My Emberheart");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GLB" }).click();
  expect(await (await dl).path()).toBeTruthy();
  await page.getByRole("button", { name: "Open emberheart-basement" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Emberheart Basement",
      exact: true,
      level: 2,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Published world" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "My Things" }).click();
  await expect(page.getByText("My Emberheart")).toBeVisible();
});

test("imports a collection of linked GLB Things into local drafts", async ({
  page,
}) => {
  await page.goto("/#/things");
  await page
    .locator('input[type="file"]')
    .setInputFiles([
      "world/starter/example-backpack.glb",
      "world/starter/example-sword.glb",
    ]);
  await expect(
    page.getByText("Imported 2 Things locally", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Traveler's Backpack",
      exact: true,
      level: 2,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open example-sword" }).click();
  await expect(
    page.getByRole("heading", { name: "Plain Sword", exact: true, level: 2 }),
  ).toBeVisible();
});

test("navigates the public planar system into the Nine Hells", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /The Planar System/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "The Planar System",
      exact: true,
      level: 2,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open planes-outer" }).click();
  await expect(
    page.getByRole("heading", { name: "Outer Planes", exact: true, level: 2 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open plane-nine-hells" }).click();
  await expect(
    page.getByRole("heading", {
      name: "The Nine Hells",
      exact: true,
      level: 2,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open hell-nessus" }),
  ).toBeVisible();
});

test("searches for an existing Thing and creates a linked local Thing", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Emberheart Tavern/ }).click();
  await page.getByRole("button", { name: "Edit local copy" }).click();
  await page.getByRole("button", { name: "＋ Add Thing" }).click();
  await page.getByLabel("Search").fill("srd52-monster-guard");
  await page
    .locator('.thing-card:has(small:text-is("srd52-monster-guard"))')
    .click();
  await expect(
    page.getByRole("button", { name: "Open srd52-monster-guard" }),
  ).toBeVisible();
  await expect(page.getByLabel("Party exit")).not.toBeChecked();
  await page.getByLabel("Party exit").check();
  await page.getByLabel("Arrival anchor").selectOption("entrance");
  await page.getByRole("button", { name: "＋ Add Thing" }).click();
  await page
    .getByRole("button", { name: "＋ Create new linked Thing" })
    .click();
  await page.getByLabel("Name").fill("Moonlit Courtyard");
  await page.getByRole("button", { name: "Create, place, and open" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Moonlit Courtyard",
      exact: true,
      level: 2,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "← Back" }).click();
  await expect(
    page.getByText("Moonlit Courtyard", { exact: true }),
  ).toBeVisible();
});
