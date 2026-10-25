import { describe, it, expect } from "vitest";
import { Assets } from "../apps/server/src/assets";
import { config } from "../apps/server/src/config";
import { randomUUID } from "node:crypto";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGN4tLcMiBggFAA8CghVo+AwTgAAAABJRU5ErkJggg==",
  "base64",
);
it("validates decoded image contents and re-encodes private assets", async () => {
  const assets = new Assets(config({ NODE_ENV: "test" }));
  const metadata = await assets.upload("image", png);
  expect(metadata).toEqual({ mime: "image/webp", width: 2, height: 2 });
  const body = await assets.read("image");
  expect(body.subarray(0, 4).toString()).toBe("RIFF");
  await expect(
    assets.upload("fake", Buffer.from("not an image")),
  ).rejects.toMatchObject({ code: "invalid_image" });
  await expect(
    assets.upload("large", Buffer.alloc(10 * 1024 * 1024 + 1)),
  ).rejects.toMatchObject({ code: "file_too_large" });
});
describe.skipIf(!process.env.S3_TEST_ENDPOINT)("S3-compatible storage", () => {
  it("persists encoded images across clients and denies anonymous access", async () => {
    const c = config({
      NODE_ENV: "test",
      S3_ENDPOINT: process.env.S3_TEST_ENDPOINT,
      S3_ACCESS_KEY: process.env.S3_TEST_ACCESS_KEY,
      S3_SECRET_KEY: process.env.S3_TEST_SECRET_KEY,
      S3_BUCKET: "wikitop-tests",
    });
    const first = new Assets(c);
    await first.ensureBucket();
    const key = `images/${randomUUID()}.webp`;
    await first.upload(key, png);
    const second = new Assets(c);
    expect(await second.read(key)).toEqual(await first.read(key));
    const denied = await fetch(`${c.S3_ENDPOINT}/${c.S3_BUCKET}/${key}`);
    expect(denied.status).toBe(403);
  });
});
