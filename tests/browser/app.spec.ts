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

test("imports a collection of linked GLB Things into local drafts",async({page})=>{
  await page.goto("/#/things");
  await page.locator('input[type="file"]').setInputFiles(["world/starter/example-backpack.glb","world/starter/example-sword.glb"]);
  await expect(page.getByText("Imported 2 Things locally",{exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Traveler's Backpack",exact:true,level:2})).toBeVisible();
  await page.getByRole("button",{name:"Open example-sword"}).click();
  await expect(page.getByRole("heading",{name:"Plain Sword",exact:true,level:2})).toBeVisible();
});
