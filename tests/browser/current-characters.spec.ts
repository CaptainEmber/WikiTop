import { test, expect } from "@playwright/test";
test("character checkboxes are non-exclusive, remembered, and bring both characters into play", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as Mara", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "My Content", exact: true }),
  ).toBeVisible();
  const characters = await page.evaluate(async () => {
    const result = [];
    for (const name of ["Current companion One", "Current companion Two"]) {
      const r = await fetch("/api/things", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset: "character", name }),
      });
      result.push(await r.json());
    }
    return result;
  });
  await page.reload();
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  const checks = page.getByRole("checkbox", { name: /^Current character / });
  for (const checkbox of await checks.all()) await checkbox.uncheck();
  for (const c of characters)
    await page
      .getByRole("checkbox", {
        name: `Current character ${c.name}`,
        exact: true,
      })
      .check();
  await page.reload();
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  for (const c of characters)
    await expect(
      page.getByRole("checkbox", {
        name: `Current character ${c.name}`,
        exact: true,
      }),
    ).toBeChecked();
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await expect(page.getByText(/2 current characters selected/)).toBeVisible();
  await page
    .getByRole("button", { name: "Enter →", exact: true })
    .first()
    .click();
  await expect(page.locator("canvas")).toBeVisible();
  for (const c of characters)
    await expect(page.getByText(`◉ ${c.name}`)).toBeVisible();
});
