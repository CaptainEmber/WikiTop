import { test, expect } from "@playwright/test";
const playUrl = process.env.SSO_PLAY_URL,
  wikiUrl = process.env.SSO_WIKI_URL;
test("shared login spans play and Wiki.js without a second password", async ({
  page,
}) => {
  test.skip(
    !playUrl || !wikiUrl || !process.env.SSO_EMAIL || !process.env.SSO_PASSWORD,
    "Supply the staging SSO environment",
  );
  await page.goto(playUrl!);
  await page.getByRole("link", { name: "Sign in to WikiTop" }).click();
  await page.locator("#username").fill(process.env.SSO_EMAIL!);
  await page.locator("#password").fill(process.env.SSO_PASSWORD!);
  await page.locator("#kc-login").click();
  if (
    await page
      .getByRole("heading", { name: "Update Account Information" })
      .isVisible()
      .catch(() => false)
  ) {
    await page.locator("#lastName").fill("Player");
    await page.getByRole("button", { name: "Submit" }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Your corner of" }),
  ).toBeVisible();
  await page.getByLabel("New area name").fill(`SSO area ${Date.now()}`);
  await page
    .getByRole("button", { name: "+ Create area", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save scene", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  const articleHref = await page
    .getByRole("link", { name: "Edit article" })
    .getAttribute("href");
  expect(articleHref).toContain(wikiUrl!);
  await page.goto(`${wikiUrl}/login`);
  const provider = page.getByText("WikiTop shared login", { exact: true });
  await expect(provider).toBeVisible();
  await provider.click();
  await page.waitForURL(
    (url) =>
      url.origin === new URL(wikiUrl!).origin &&
      !url.pathname.startsWith("/login"),
    { timeout: 20000 },
  );
  await page.goto(articleHref!);
  expect(new URL(page.url()).origin).toBe(new URL(wikiUrl!).origin);
  await expect(page.locator("body")).toContainText(
    "A place waiting for stories.",
    { timeout: 20000 },
  );
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});
