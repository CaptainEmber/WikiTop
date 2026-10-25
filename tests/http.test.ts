import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../apps/server/src/app";
import { config } from "../apps/server/src/config";
import { MemoryStore } from "../apps/server/src/store";
import { MemoryWiki } from "../apps/server/src/wiki";
import { World } from "../apps/server/src/world";
import { seedDemo } from "../apps/server/src/demo";
let server: Awaited<ReturnType<typeof buildApp>>, cookie: string;
beforeEach(async () => {
  const store = new MemoryStore(),
    world = new World(store, new MemoryWiki());
  await seedDemo(world);
  server = await buildApp(
    config({
      NODE_ENV: "test",
      DEV_AUTH: "true",
      WIKI_MODE: "memory",
      APP_URL: "http://localhost:3000",
    }),
    store,
    world,
  );
  const response = await server.app.inject({
    method: "POST",
    url: "/auth/dev",
    headers: { origin: "http://localhost:3000" },
    payload: { accountId: "mara" },
  });
  cookie = response.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
});
afterEach(async () => {
  await server.app.close();
});
describe("HTTP boundaries", () => {
  it("requires authentication and rejects cross-origin mutations", async () => {
    expect((await server.app.inject("/api/library")).statusCode).toBe(401);
    expect(
      (
        await server.app.inject({
          method: "POST",
          url: "/api/areas",
          headers: { cookie, origin: "https://attacker.test" },
          payload: { name: "Bad" },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("validates inputs and returns structured errors", async () => {
    const response = await server.app.inject({
      method: "POST",
      url: "/api/areas",
      headers: { cookie, origin: "http://localhost:3000" },
      payload: { name: "", ownerId: "rowan" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_input");
  });
  it("serves library only after login and invalidates logout", async () => {
    const r = await server.app.inject({
      url: "/api/library",
      headers: { cookie },
    });
    expect(r.json().account.id).toBe("mara");
    await server.app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie, origin: "http://localhost:3000" },
    });
    expect(
      (await server.app.inject({ url: "/api/library", headers: { cookie } }))
        .statusCode,
    ).toBe(401);
  });
  it("rejects invalid image bytes", async () => {
    const body = Buffer.from(
      '--b\r\nContent-Disposition: form-data; name="file"; filename="fake.png"\r\nContent-Type: image/png\r\n\r\nnot an image\r\n--b--\r\n',
    );
    const r = await server.app.inject({
      method: "POST",
      url: "/api/assets",
      headers: {
        cookie,
        origin: "http://localhost:3000",
        "content-type": "multipart/form-data; boundary=b",
      },
      payload: body,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("invalid_image");
  });
  it("forbids development features in production", () => {
    expect(() => config({ NODE_ENV: "production", DEV_AUTH: "true" })).toThrow(
      "Production forbids",
    );
  });
  it("protects uploaded images from unrelated accounts", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGN4tLcMiBggFAA8CghVo+AwTgAAAABJRU5ErkJggg==",
      "base64",
    );
    const body = Buffer.concat([
      Buffer.from(
        '--image\r\nContent-Disposition: form-data; name="file"; filename="token.png"\r\nContent-Type: image/png\r\n\r\n',
      ),
      png,
      Buffer.from("\r\n--image--\r\n"),
    ]);
    const uploaded = await server.app.inject({
      method: "POST",
      url: "/api/assets",
      headers: {
        cookie,
        origin: "http://localhost:3000",
        "content-type": "multipart/form-data; boundary=image",
      },
      payload: body,
    });
    expect(uploaded.statusCode).toBe(200);
    const assetId = uploaded.json().id;
    expect(
      (
        await server.app.inject({
          url: `/api/assets/${assetId}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
    const login = await server.app.inject({
      method: "POST",
      url: "/auth/dev",
      headers: { origin: "http://localhost:3000" },
      payload: { accountId: "rowan" },
    });
    const otherCookie = login.cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    expect(
      (
        await server.app.inject({
          url: `/api/assets/${assetId}`,
          headers: { cookie: otherCookie },
        })
      ).statusCode,
    ).toBe(403);
  });
});

it("protects private interior backgrounds until the container is visible and peerable", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGN4tLcMiBggFAA8CghVo+AwTgAAAABJRU5ErkJggg==",
    "base64",
  );
  const body = Buffer.concat([
    Buffer.from(
      '--private\r\nContent-Disposition: form-data; name="file"; filename="private.png"\r\nContent-Type: image/png\r\n\r\n',
    ),
    png,
    Buffer.from("\r\n--private--\r\n"),
  ]);
  const upload = await server.app.inject({
    method: "POST",
    url: "/api/assets",
    headers: {
      cookie,
      origin: "http://localhost:3000",
      "content-type": "multipart/form-data; boundary=private",
    },
    payload: body,
  });
  expect(upload.statusCode).toBe(200);
  const assetId = upload.json().id,
    world = server.world,
    state = await world.store.read(),
    session = Object.values(state.sessions)[0],
    mara = Object.values(state.characters).find((c) => c.ownerId === "mara")!,
    rowan = Object.values(state.characters).find((c) => c.ownerId === "rowan")!;
  await world.updateCharacter("mara", mara.id, {
    children: [
      {
        id: "private-bag",
        name: "Bag",
        description: "",
        role: "inventory",
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
        visible: true,
        peerable: false,
        space: { width: 20, depth: 16, backgroundAssetId: assetId },
        children: [],
      },
    ],
  });
  await world.join("mara", session.id, mara.id);
  await world.join("rowan", session.id, rowan.id);
  const login = await server.app.inject({
      method: "POST",
      url: "/auth/dev",
      headers: { origin: "http://localhost:3000" },
      payload: { accountId: "rowan" },
    }),
    otherCookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const read = () =>
    server.app.inject({
      url: `/api/assets/${assetId}`,
      headers: { cookie: otherCookie },
    });
  expect((await read()).statusCode).toBe(403);
  let next = await world.store.read();
  const bag = next.sessions[session.id].inventories![mara.id][0];
  expect(
    JSON.stringify(world.snapshot(next, "rowan", session.id, rowan.id)),
  ).not.toContain(assetId);
  await world.command("mara", {
    type: "interact",
    action: "flags",
    sessionId: session.id,
    characterId: mara.id,
    operationId: "open-private-bag",
    revision: next.sessions[session.id].liveRevision ?? 0,
    viewTarget: {
      kind: "interior",
      root: "character",
      rootId: mara.id,
      path: [],
    },
    targetId: bag.id,
    peerable: true,
  });
  expect((await read()).statusCode).toBe(200);
  next = await world.store.read();
  await world.command("mara", {
    type: "interact",
    action: "flags",
    sessionId: session.id,
    characterId: mara.id,
    operationId: "hide-private-bag",
    revision: next.sessions[session.id].liveRevision ?? 0,
    viewTarget: {
      kind: "interior",
      root: "character",
      rootId: mara.id,
      path: [],
    },
    targetId: bag.id,
    visible: false,
  });
  expect((await read()).statusCode).toBe(403);
});

it("serves generated article exits only to authorized readers", async () => {
  const lib = (
    await server.app.inject({ url: "/api/library", headers: { cookie } })
  ).json();
  const area = lib.areas.find((a: any) => a.ownerId === "mara");
  expect(
    (await server.app.inject(`/api/areas/${area.id}/article`)).statusCode,
  ).toBe(401);
  const response = await server.app.inject({
    url: `/api/areas/${area.id}/article`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  const linked = response.json().exits.find((e: any) => e.targetAreaId);
  expect(linked.destinationName).toBeTruthy();
  const editor = await server.app.inject({
    url: `/api/dev/wiki/${area.articleId}`,
    headers: { cookie },
  });
  expect(editor.body).toContain("<h2>Exits</h2>");
  expect(editor.body).toContain(`/articles/${linked.targetAreaId}`);
  const bad = await server.app.inject({
    url: `/api/areas/${area.id}/article?sessionId=missing`,
    headers: { cookie },
  });
  expect(bad.statusCode).toBe(403);
});

it("authorizes uploaded GLB assets and rejects malformed model uploads", async () => {
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile("apps/web/public/assets/sample.glb");
  const boundary = "wikitop-model-test";
  const upload = (body: Buffer) =>
    server.app.inject({
      method: "POST",
      url: "/api/assets",
      headers: {
        cookie,
        origin: "http://localhost:3000",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="model.glb"\r\nContent-Type: model/gltf-binary\r\n\r\n`,
        ),
        body,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
  const response = await upload(bytes);
  expect(response.statusCode).toBe(200);
  const asset = response.json();
  expect(asset.kind).toBe("model");
  const read = await server.app.inject({
    url: `/api/assets/${asset.id}`,
    headers: { cookie },
  });
  expect(read.headers["content-type"]).toContain("model/gltf-binary");
  expect(read.rawPayload).toEqual(bytes);
  const login = await server.app.inject({
    method: "POST",
    url: "/auth/dev",
    headers: { origin: "http://localhost:3000" },
    payload: { accountId: "lyra" },
  });
  const other = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  expect(
    (
      await server.app.inject({
        url: `/api/assets/${asset.id}`,
        headers: { cookie: other },
      })
    ).statusCode,
  ).toBe(403);
  expect((await upload(Buffer.from("not a model"))).statusCode).toBe(400);
});
it("enforces document revisions and does not grant authoring through play access", async () => {
  const library = (
    await server.app.inject({ url: "/api/library", headers: { cookie } })
  ).json();
  const area = library.areas.find((a: any) => a.ownerId === "mara");
  const response = await server.app.inject({
    url: `/api/things/${area.id}/document`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  const draft = response.json();
  draft.document.nodes[area.id].description =
    "Edited using the unified document";
  const headers = { cookie, origin: "http://localhost:3000" };
  const payload = {
    revision: draft.revision,
    operationId: "document-http-save",
    document: draft.document,
  };
  expect(
    (
      await server.app.inject({
        method: "PUT",
        url: `/api/things/${area.id}/document`,
        headers,
        payload,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await server.app.inject({
        method: "PUT",
        url: `/api/things/${area.id}/document`,
        headers,
        payload,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await server.app.inject({
        method: "PUT",
        url: `/api/things/${area.id}/document`,
        headers,
        payload: { ...payload, operationId: "different-http-save" },
      })
    ).statusCode,
  ).toBe(409);
});
