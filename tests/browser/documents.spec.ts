import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function login(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as Mara", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "My Content", exact: true }),
  ).toBeVisible();
}
async function api(page: Page, path: string, method = "GET", body?: unknown) {
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
async function saved(page: Page) {
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByLabel("Save status", { exact: true })).toHaveText(
    "Saved",
  );
}
test("character cards open the shared workspace and autosave nested Things", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await expect(page.locator("select[aria-label=Character]")).toHaveCount(0);
  await page.getByRole("button", { name: /New character/ }).click();
  await page.getByLabel("Name", { exact: true }).fill("Card navigator");
  await saved(page);
  const root = (await api(page, "/api/library")).data.characters.find(
    (c: any) => c.name === "Card navigator",
  );
  expect(root).toBeTruthy();
  await page
    .getByRole("button", { name: "Add interior space", exact: true })
    .click();
  await page.getByLabel("Space width", { exact: true }).fill("24");
  await page.getByRole("button", { name: "＋ Container", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Travel bag");
  await page.getByRole("checkbox", { name: "Peerable", exact: true }).check();
  await page.getByRole("button", { name: "Open inside", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Travel bag", exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "＋ Attribute", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Supplies");
  await page.getByLabel("Value", { exact: true }).fill("12");
  await saved(page);
  await page.getByRole("button", { name: "3D Scene", exact: true }).click();
  await page.getByRole("button", { name: "← Back", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "3D Scene", exact: true }),
  ).toHaveClass("active");
  await page.getByRole("button", { name: "Article", exact: true }).click();
  await expect(page.locator(".thing-article")).toContainText("Travel bag");
  await page.getByRole("button", { name: "Document", exact: true }).click();
  await expect(page.locator(".document-preview")).toContainText(
    '"schemaVersion": 1',
  );
  const draft = (await api(page, `/api/things/${root.id}/document`)).data;
  const bag = Object.values(draft.document.nodes).find(
    (n: any) => n.name === "Travel bag",
  ) as any;
  const supplies = Object.values(draft.document.nodes).find(
    (n: any) => n.name === "Supplies",
  ) as any;
  expect(supplies.value).toBe(12);
  expect(
    draft.document.placements.find((p: any) => p.childId === supplies.id)
      .parentId,
  ).toBe(bag.id);
  await page.getByRole("button", { name: "Characters", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Edit character Card navigator",
      exact: true,
    }),
  ).toBeVisible();
});
test("offline drafts recover and stale saves keep a local conflict copy", async ({
  page,
  context,
}) => {
  await login(page);
  const root = (
    await api(page, "/api/things", "POST", {
      preset: "character",
      name: "Recovery draft",
    })
  ).data;
  await page.goto(`/?thing=${root.id}`);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Recovery draft",
  );
  await context.setOffline(true);
  await page.getByLabel("Name", { exact: true }).fill("Offline draft");
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByLabel("Save status", { exact: true })).toHaveText(
    "Offline",
  );
  await context.setOffline(false);
  await expect(page.getByLabel("Save status", { exact: true })).toHaveText(
    "Saved",
  );
  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Offline draft",
  );
  const remote = (await api(page, `/api/things/${root.id}/document`)).data;
  remote.document.nodes[root.id].name = "Other editor";
  expect(
    (
      await api(page, `/api/things/${root.id}/document`, "PUT", {
        revision: remote.revision,
        operationId: crypto.randomUUID(),
        document: remote.document,
      })
    ).status,
  ).toBe(200);
  await page.getByLabel("Name", { exact: true }).fill("My conflicted draft");
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByLabel("Save status", { exact: true })).toHaveText(
    "Conflict",
  );
  await expect(
    page.getByRole("button", { name: "Copy local document", exact: true }),
  ).toBeVisible();
  expect(
    (await api(page, `/api/things/${root.id}/document`)).data.document.nodes[
      root.id
    ].name,
  ).toBe("Other editor");
  await page
    .getByRole("button", { name: "Reload latest draft", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Other editor",
  );
  expect(
    await page.evaluate(
      ({ rootId }) =>
        Object.entries(localStorage).some(
          ([key, value]) =>
            key.endsWith(":conflict-backup") &&
            key.includes(rootId) &&
            value.includes("My conflicted draft"),
        ),
      { rootId: root.id },
    ),
  ).toBe(true);
});
test("uploaded GLB and hotlinked media render with failure fallbacks", async ({
  page,
}) => {
  await login(page);
  const root = (
    await api(page, "/api/things", "POST", {
      preset: "place",
      name: "Media workspace",
    })
  ).data;
  await page.goto(`/?thing=${root.id}`);
  await page.getByRole("button", { name: "＋ Thing", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Model token");
  await page.getByLabel("Upload 3D model", { exact: true }).setInputFiles({
    name: "sample.glb",
    mimeType: "model/gltf-binary",
    buffer: await readFile("apps/web/public/assets/sample.glb"),
  });
  await expect(page.getByLabel("Presentation", { exact: true })).toHaveValue(
    "model",
  );
  await saved(page);
  await page.getByRole("button", { name: "3D Scene", exact: true }).click();
  await expect(page.locator("canvas")).toBeVisible();
  await page.route("https://art.example.test/broken.png", (route) =>
    route.fulfill({
      status: 404,
      headers: { "access-control-allow-origin": "*" },
      body: "missing",
    }),
  );
  await page
    .getByLabel("Map token URL", { exact: true })
    .fill("https://art.example.test/broken.png");
  await page
    .getByRole("button", { name: "Use URL for Map token", exact: true })
    .click();
  await saved(page);
  await page.getByRole("button", { name: "2D Map", exact: true }).click();
  await expect(
    page.getByText("Model token · media unavailable", { exact: true }),
  ).toBeVisible();
  const draft = (await api(page, `/api/things/${root.id}/document`)).data;
  const node = Object.values(draft.document.nodes).find(
    (n: any) => n.name === "Model token",
  ) as any;
  expect(node.media.model.kind).toBe("asset");
  expect(node.media.token).toEqual({
    kind: "url",
    url: "https://art.example.test/broken.png",
    type: "image",
  });
  await page.getByLabel("Name", { exact: true }).fill("Still editable");
  await saved(page);
});

test("autosave retries a temporary server outage with the same operation ID", async ({
  page,
}) => {
  await login(page);
  const root = (
    await api(page, "/api/things", "POST", {
      preset: "character",
      name: "Transient draft",
    })
  ).data;
  await page.goto(`/?thing=${root.id}`);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Transient draft",
  );
  const operations: string[] = [];
  await page.route(`**/api/things/${root.id}/document`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    operations.push(route.request().postDataJSON().operationId);
    if (operations.length === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "temporarily_unavailable",
            message: "Temporary server outage",
          },
        }),
      });
    return route.continue();
  });
  await page
    .getByLabel("Name", { exact: true })
    .fill("Automatically recovered");
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByLabel("Save status", { exact: true })).toHaveText(
    "Offline",
  );
  await expect(page.getByLabel("Save status", { exact: true })).toHaveText(
    "Saved",
    { timeout: 10000 },
  );
  expect(operations.length).toBeGreaterThanOrEqual(2);
  expect(new Set(operations).size).toBe(1);
  expect(
    (await api(page, `/api/things/${root.id}/document`)).data.document.nodes[
      root.id
    ].name,
  ).toBe("Automatically recovered");
});
