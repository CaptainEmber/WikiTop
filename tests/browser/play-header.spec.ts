import { test, expect } from "@playwright/test";
test("compact live navigation returns through the named header button and swaps via character cards", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as Mara", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "My Content", exact: true }),
  ).toBeVisible();
  const created = await page.evaluate(async () => {
    const r = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Header swap companion" }),
    });
    return r.json();
  });
  await page.reload();
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page
    .getByRole("button", { name: "Enter →", exact: true })
    .first()
    .click();
  await expect(
    page.locator('.play-workspace[data-connection-status="Live"]'),
  ).toBeVisible();
  const header = page.locator(".header"),
    home = header.getByRole("button", {
      name: "Return to character",
      exact: true,
    });
  const originalName = await home.innerText();
  await expect(
    header.getByRole("button", { name: "Swap character", exact: true }),
  ).toBeVisible();
  const bar = page.locator(".play-navigation");
  await expect(
    bar.getByRole("navigation", { name: "Viewed space" }),
  ).toBeVisible();
  await expect(bar.getByRole("heading")).toHaveCount(0);
  await expect(bar.locator(".eyebrow")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Leave session", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "← Back", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Common area", { exact: true })).toHaveCount(0);
  const state = await page.evaluate(async () => {
    const lib = await (await fetch("/api/library")).json();
    return {
      sessionId: lib.sessions[0].id,
      character: lib.characters.find((c: any) => c.name === "Mara"),
    };
  });
  const placement = () =>
    page.evaluate(
      async ({ sessionId, character }) =>
        (
          await (
            await fetch(`/api/sessions/${sessionId}/snapshot/${character.id}`)
          ).json()
        ).placement,
      state,
    );
  const before = await placement();
  await page
    .getByRole("button", { name: "Enter yourself", exact: true })
    .click();
  await expect(
    bar.getByRole("button", { name: originalName, exact: true }),
  ).toBeVisible();
  await home.click();
  await expect(bar.getByRole("button")).toHaveCount(1);
  expect(await placement()).toEqual(before);
  await header
    .getByRole("button", { name: "Swap character", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Characters", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Choose a character to use in your current session.", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: `Select character ${created.name}`,
      exact: true,
    })
    .click();
  await expect(home).toHaveText(created.name);
  await expect(
    page.locator('.play-workspace[data-connection-status="Live"]'),
  ).toBeVisible();
  expect(await placement()).toEqual(before);
  await expect(
    page.getByRole("button", { name: `◉ ${originalName}`, exact: true }),
  ).toBeVisible();
  await header
    .getByRole("button", { name: "Swap character", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel swap", exact: true }).click();
  await expect(home).toHaveText(created.name);
});
