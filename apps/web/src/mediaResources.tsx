import React, { useEffect } from "react";
import { Texture, SRGBColorSpace, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { validateGlb } from "@wikitop/shared";
import { Html } from "@react-three/drei";
export async function fetchAssetBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    credentials: url.startsWith("https:") ? "omit" : "same-origin",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error("Asset unavailable");
  if (Number(response.headers.get("Content-Length")) > 10 * 1024 * 1024) {
    await response.body?.cancel();
    throw new Error("Asset exceeds 10 MiB");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Asset has no body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 10 * 1024 * 1024) throw new Error("Asset exceeds 10 MiB");
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel();
    throw e;
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}
type Resource<T> = {
  promise: Promise<void>;
  value?: T;
  error?: unknown;
  refs: number;
  dispose: (value: T) => void;
  timer?: ReturnType<typeof setTimeout>;
};
const textures = new Map<string, Resource<Texture>>(),
  models = new Map<string, Resource<Object3D>>();
function resource<T>(
  cache: Map<string, Resource<T>>,
  key: string,
  load: () => Promise<T>,
  dispose: (value: T) => void,
) {
  let r = cache.get(key);
  if (!r) {
    r = { refs: 0, dispose, promise: Promise.resolve() };
    const item = r;
    item.promise = load().then(
      (value) => {
        item.value = value;
        item.timer = setTimeout(() => {
          if (!item.refs) {
            item.dispose(value);
            cache.delete(key);
          }
        }, 5000);
      },
      (error) => {
        item.error = error;
      },
    );
    cache.set(key, item);
    if (cache.size > 64)
      for (const [old, v] of cache)
        if (v.error && old !== key) {
          cache.delete(old);
          break;
        }
  }
  return r;
}
function useResource<T>(
  cache: Map<string, Resource<T>>,
  key: string,
  r: Resource<T>,
): T {
  useEffect(() => {
    r.refs++;
    if (r.timer) clearTimeout(r.timer);
    return () => {
      r.refs--;
      r.timer = setTimeout(() => {
        if (!r.refs) {
          if (r.value) r.dispose(r.value);
          cache.delete(key);
        }
      }, 1000);
    };
  }, [r, key, cache]);
  if (r.error) throw r.error;
  if (!r.value) throw r.promise;
  return r.value;
}
export function useSafeTexture(url: string) {
  return useResource(
    textures,
    url,
    resource(
      textures,
      url,
      async () => {
        const bytes = await fetchAssetBytes(url);
        let bitmap: ImageBitmap | HTMLImageElement;
        if (url.startsWith("/assets/") && url.endsWith(".svg")) {
          const objectUrl = URL.createObjectURL(
            new Blob([bytes], { type: "image/svg+xml" }),
          );
          try {
            const image = new Image();
            image.src = objectUrl;
            await image.decode();
            bitmap = image;
          } finally {
            URL.revokeObjectURL(objectUrl);
          }
        } else
          bitmap = await createImageBitmap(new Blob([bytes]), {
            imageOrientation: "flipY",
            premultiplyAlpha: "none",
          });
        if (bitmap.width > 4096 || bitmap.height > 4096) {
          if ("close" in bitmap) bitmap.close();
          throw new Error("Image exceeds 4096 × 4096");
        }
        const texture = new Texture(bitmap);
        texture.colorSpace = SRGBColorSpace;
        texture.needsUpdate = true;
        return texture;
      },
      (texture) => {
        texture.dispose();
        (texture.image as ImageBitmap)?.close?.();
      },
    ),
  );
}
export function useSafeModel(url: string) {
  return useResource(
    models,
    url,
    resource(
      models,
      url,
      async () => {
        const bytes = await fetchAssetBytes(url);
        validateGlb(bytes);
        const gltf = await new GLTFLoader().parseAsync(bytes, "");
        gltf.scene.traverse((node: any) => {
          const materials = node.material
            ? Array.isArray(node.material)
              ? node.material
              : [node.material]
            : [];
          for (const material of materials)
            for (const value of Object.values(material))
              if ((value as any)?.isTexture) {
                const image = (value as any).image;
                if (image?.width > 4096 || image?.height > 4096)
                  throw new Error("Model texture exceeds 4096 × 4096");
              }
        });
        return gltf.scene;
      },
      (scene) => {
        const disposed = new Set<any>();
        scene.traverse((node: any) => {
          if (node.geometry && !disposed.has(node.geometry)) {
            disposed.add(node.geometry);
            node.geometry.dispose();
          }
          for (const m of node.material
            ? Array.isArray(node.material)
              ? node.material
              : [node.material]
            : []) {
            if (disposed.has(m)) continue;
            disposed.add(m);
            for (const value of Object.values(m))
              if ((value as any)?.isTexture && !disposed.has(value)) {
                disposed.add(value);
                (value as any).dispose();
              }
            m.dispose();
          }
        });
      },
    ),
  );
}
export class MediaBoundary extends React.Component<
  { name: string; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <group>
        <mesh>
          <boxGeometry args={[1, 1, 0.05]} />
          <meshBasicMaterial color="#69513c" />
        </mesh>
        <Html center>
          <span className="scene-label">
            {this.props.name} · media unavailable
          </span>
        </Html>
      </group>
    ) : (
      this.props.children
    );
  }
}
