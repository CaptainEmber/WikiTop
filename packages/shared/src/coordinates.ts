import {
  AreaSceneSchema,
  type AreaScene,
  type Vec3,
  type Thing,
} from "./index.js";

/** Rotate the legacy Y-up basis into Z-up: X stays right, map north becomes +Y. */
export function yUpToZUp([x, y, z]: Vec3): Vec3 {
  return [x, z === 0 ? 0 : -z, y];
}
type Quaternion = [number, number, number, number];
function multiply(a: Quaternion, b: Quaternion): Quaternion {
  const [x, y, z, w] = a,
    [i, j, k, v] = b;
  return [
    w * i + x * v + y * k - z * j,
    w * j - x * k + y * v + z * i,
    w * k + x * j - y * i + z * v,
    w * v - x * i - y * j - z * k,
  ];
}
export function rotateLegacyQuaternion(q: Quaternion): Quaternion {
  const h = Math.SQRT1_2;
  return multiply(multiply([h, 0, 0, h], q), [-h, 0, 0, h]).map((n) =>
    Math.abs(n) < 1e-14 ? 0 : n,
  ) as Quaternion;
}
/** Explicit format conversion; regular scene reads accept only version 2. */
export function migrateSceneToZUp(input: unknown): AreaScene {
  const scene = input as any;
  if (scene?.schemaVersion === 2) return AreaSceneSchema.parse(scene);
  if (scene?.schemaVersion !== 1)
    throw new Error("Unsupported coordinate schema version");
  const thing = (t: any): Thing => ({
    ...t,
    position: yUpToZUp(t.position ?? [0, 0, 0]),
    rotation: rotateLegacyQuaternion(t.rotation ?? [0, 0, 0, 1]),
    scale: [t.scale?.[0] ?? 1, t.scale?.[2] ?? 1, t.scale?.[1] ?? 1],
    children: (t.children ?? []).map(thing),
  });
  const endpoint = (e: any) => ({ ...e, position: yUpToZUp(e.position) });
  return AreaSceneSchema.parse({
    ...scene,
    schemaVersion: 2,
    things: scene.things.map(thing),
    zones: scene.zones.map(({ z, ...zone }: any) => ({
      ...zone,
      y: z === 0 ? 0 : -z,
    })),
    doors: scene.doors.map(endpoint),
    anchors: scene.anchors.map(endpoint),
  });
}
