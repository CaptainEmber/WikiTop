import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { validateGlb } from "@wikitop/shared";
import type { Config } from "./config.js";
import { requireThat } from "./errors.js";
export class Assets {
  private s3?: S3Client;
  private memory = new Map<string, Buffer>();
  constructor(private c: Config) {
    if (c.S3_ENDPOINT)
      this.s3 = new S3Client({
        endpoint: c.S3_ENDPOINT,
        region: c.S3_REGION,
        forcePathStyle: true,
        credentials: {
          accessKeyId: c.S3_ACCESS_KEY ?? "",
          secretAccessKey: c.S3_SECRET_KEY ?? "",
        },
      });
  }
  demoCheckpointImages(): [string, string][] {
    if (this.c.NODE_ENV === "production" || this.s3)
      throw new Error("Only the local in-memory demo can checkpoint media");
    return [...this.memory].map(([key, value]) => [
      key,
      value.toString("base64"),
    ]);
  }
  restoreDemoImages(entries: [string, string][]) {
    if (this.c.NODE_ENV === "production" || this.s3)
      throw new Error(
        "Only a local in-memory demo can restore image checkpoints",
      );
    this.memory = new Map(
      entries.map(([key, value]) => [key, Buffer.from(value, "base64")]),
    );
  }
  async ensureBucket() {
    if (!this.s3) return;
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.c.S3_BUCKET }));
    } catch (error: any) {
      if (error.$metadata?.httpStatusCode !== 404) throw error;
      await this.s3.send(new CreateBucketCommand({ Bucket: this.c.S3_BUCKET }));
    }
  }
  async upload(key: string, buffer: Buffer) {
    requireThat(
      buffer.length <= 10 * 1024 * 1024,
      "file_too_large",
      "Images must be at most 10 MiB",
      413,
    );
    let meta;
    try {
      meta = await sharp(buffer, {
        limitInputPixels: 4096 * 4096,
        animated: false,
      }).metadata();
    } catch {
      requireThat(
        false,
        "invalid_image",
        "Upload a valid PNG, JPEG, or WebP image",
      );
    }
    requireThat(
      meta &&
        ["png", "jpeg", "webp"].includes(meta.format ?? "") &&
        meta.width &&
        meta.height &&
        meta.width <= 4096 &&
        meta.height <= 4096 &&
        (meta.pages ?? 1) === 1,
      "invalid_image",
      "Use a single image up to 4096 × 4096 pixels",
    );
    // Re-encode to strip metadata and any unparsed trailing payload.
    const body = await sharp(buffer, { limitInputPixels: 4096 * 4096 })
      .rotate()
      .webp()
      .toBuffer();
    const decoded = await sharp(body).metadata();
    if (this.s3)
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.c.S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: "image/webp",
        }),
      );
    else {
      requireThat(
        this.c.NODE_ENV !== "production",
        "storage_unavailable",
        "Configure object storage",
        503,
      );
      this.memory.set(key, body);
    }
    return {
      mime: "image/webp",
      width: decoded.width!,
      height: decoded.height!,
    };
  }
  async uploadModel(key: string, buffer: Buffer) {
    try {
      validateGlb(
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ) as ArrayBuffer,
      );
    } catch (error) {
      requireThat(false, "invalid_model", (error as Error).message, 400);
    }
    const jsonSize = buffer.readUInt32LE(12),
      json = JSON.parse(buffer.subarray(20, 20 + jsonSize).toString());
    const binaryStart = 20 + jsonSize + 8;
    for (const image of json.images ?? []) {
      const view = json.bufferViews?.[image.bufferView];
      requireThat(view, "invalid_model", "Invalid texture buffer", 400);
      let meta;
      try {
        meta = await sharp(
          buffer.subarray(
            binaryStart + (view.byteOffset ?? 0),
            binaryStart + (view.byteOffset ?? 0) + view.byteLength,
          ),
          { limitInputPixels: 4096 * 4096 },
        ).metadata();
      } catch {
        requireThat(false, "invalid_model", "Invalid embedded texture", 400);
      }
      requireThat(
        meta?.width &&
          meta.height &&
          meta.width <= 4096 &&
          meta.height <= 4096 &&
          (meta.pages ?? 1) === 1,
        "invalid_model",
        "Embedded textures must be single images up to 4096 × 4096",
        400,
      );
    }
    if (this.s3)
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.c.S3_BUCKET,
          Key: key,
          Body: buffer,
          ContentType: "model/gltf-binary",
        }),
      );
    else {
      requireThat(
        this.c.NODE_ENV !== "production",
        "storage_unavailable",
        "Configure object storage",
        503,
      );
      this.memory.set(key, buffer);
    }
    return {
      mime: "model/gltf-binary",
      width: 0,
      height: 0,
      kind: "model" as const,
    };
  }
  async read(key: string) {
    if (this.s3) {
      const result = await this.s3.send(
        new GetObjectCommand({ Bucket: this.c.S3_BUCKET, Key: key }),
      );
      return Buffer.from(await result.Body!.transformToByteArray());
    }
    const body = this.memory.get(key);
    requireThat(body, "not_found", "Image unavailable", 404);
    return body;
  }
}
