import { test, expect } from "@playwright/test";

test("edits, restores, exports, opens and inserts a portable Thing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Thing" }).click();
  await page.getByLabel("Name").fill("Pocket Realm");
  await page.getByRole("button", { name: /Container/ }).click();
  await page.getByLabel("Name").fill("Backpack");
  await page.getByRole("button", { name: "Open inside Backpack" }).click();
  await page.getByRole("button", { name: /Attribute/ }).click();
  await page.getByLabel("Name").fill("Courage");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Pocket Realm", exact: true, level: 2 })).toBeVisible();
  const tree = page.getByRole("navigation", { name: "Thing hierarchy" });
  await expect(tree.getByRole("button", { name: "Open inside Pocket Realm", exact: true })).toBeVisible();
  await tree.getByRole("button", { name: "Expand Backpack" }).click();
  await expect(tree.getByRole("button", { name: "Open inside Courage", exact: true })).toBeVisible();

  const exportDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GLB", exact: true }).click();
  const exported = await exportDownload;
  const exportPath = await exported.path();
  expect(exportPath).toBeTruthy();

  const openChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open GLB", exact: true }).click();
  await (await openChooser).setFiles(exportPath!);
  await expect(tree.getByRole("button", { name: "Open inside Pocket Realm", exact: true })).toBeVisible();
  const insertChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Insert GLB", exact: true }).click();
  await (await insertChooser).setFiles(exportPath!);
  await expect(tree.getByRole("button", { name: "Open inside Pocket Realm", exact: true })).toHaveCount(2);
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
});
