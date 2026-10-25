/** Core static GLB only: validate before invoking loaders (which may fetch URIs). */
export function validateGlb(buffer: ArrayBuffer): void {
  const fail = (message: string): never => {
    throw new Error(message);
  };
  if (buffer.byteLength > 10 * 1024 * 1024 || buffer.byteLength < 20)
    fail("GLB must be at most 10 MiB");
  const v = new DataView(buffer);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== buffer.byteLength
  )
    fail("Invalid GLB 2.0 header");
  let offset = 12,
    json: any,
    binLength = 0,
    chunks = 0;
  while (offset < buffer.byteLength) {
    if (offset + 8 > buffer.byteLength) fail("Invalid GLB chunk");
    const size = v.getUint32(offset, true),
      type = v.getUint32(offset + 4, true);
    offset += 8;
    if (size % 4 || offset + size > buffer.byteLength)
      fail("Invalid GLB chunk length");
    if (chunks++ === 0) {
      if (type !== 0x4e4f534a) fail("GLB must begin with JSON");
      try {
        json = JSON.parse(
          new TextDecoder().decode(new Uint8Array(buffer, offset, size)),
        );
      } catch {
        fail("Invalid GLB JSON");
      }
    } else {
      if (type !== 0x004e4942 || chunks > 2) fail("Unsupported GLB chunks");
      binLength = size;
    }
    offset += size;
  }
  if (
    json?.asset?.version !== "2.0" ||
    json.extensionsUsed?.length ||
    json.extensionsRequired?.length ||
    json.animations?.length ||
    json.skins?.length
  )
    fail("Use a core static GLB without extensions, animation or skins");
  if (
    (json.buffers?.length ?? 0) > 1 ||
    (json.nodes?.length ?? 0) > 2000 ||
    (json.images?.length ?? 0) > 64 ||
    (json.materials?.length ?? 0) > 256
  )
    fail("Model exceeds supported complexity");
  for (const b of json.buffers ?? [])
    if (
      b.uri !== undefined ||
      !Number.isInteger(b.byteLength) ||
      b.byteLength < 0 ||
      b.byteLength > binLength
    )
      fail("Embed all model resources in the GLB");
  for (const image of json.images ?? [])
    if (
      image.uri !== undefined ||
      !Number.isInteger(image.bufferView) ||
      !["image/png", "image/jpeg"].includes(image.mimeType)
    )
      fail("Embed PNG/JPEG textures in the GLB");
  for (const b of json.bufferViews ?? []) {
    const start = b.byteOffset ?? 0;
    if (
      (b.buffer ?? 0) !== 0 ||
      !Number.isInteger(start) ||
      start < 0 ||
      !Number.isInteger(b.byteLength) ||
      b.byteLength < 0 ||
      start + b.byteLength > binLength
    )
      fail("Invalid model buffer view");
  }
  let vertices = 0,
    accessorBytes = 0;
  const components: Record<number, number> = {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5125: 4,
    5126: 4,
  };
  const sizes: Record<string, number> = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
  };
  for (const a of json.accessors ?? []) {
    if (
      !Number.isInteger(a.count) ||
      a.count < 0 ||
      a.count > 750000 ||
      a.sparse
    )
      fail("Invalid or unsupported accessor");
    const element = (components[a.componentType] ?? 0) * (sizes[a.type] ?? 0),
      start = a.byteOffset ?? 0;
    if (!element || !Number.isInteger(start) || start < 0)
      fail("Unsupported accessor format");
    accessorBytes += element * a.count;
    if (accessorBytes > 32 * 1024 * 1024)
      fail("Model exceeds decoded geometry budget");
    if (a.bufferView !== undefined) {
      const view = json.bufferViews?.[a.bufferView],
        stride = view?.byteStride ?? element;
      if (
        !view ||
        !Number.isInteger(stride) ||
        stride < element ||
        stride > 252 ||
        start + Math.max(0, a.count - 1) * stride + element > view.byteLength
      )
        fail("Accessor exceeds its buffer view");
    }
    vertices += a.count;
    if (vertices > 3000000) fail("Model exceeds geometry budget");
  }
  let triangles = 0;
  for (const mesh of json.meshes ?? [])
    for (const p of mesh.primitives ?? []) {
      if ((p.mode ?? 4) !== 4) fail("Only triangle meshes are supported");
      const accessor = json.accessors?.[p.indices ?? p.attributes?.POSITION];
      if (!accessor) fail("Missing geometry accessor");
      triangles += accessor.count / 3;
    }
  const nodes = json.nodes ?? [],
    parents = new Map<number, number>();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.mesh !== undefined && !json.meshes?.[n.mesh])
      fail("Invalid mesh reference");
    for (const [key, length] of [
      ["translation", 3],
      ["rotation", 4],
      ["scale", 3],
      ["matrix", 16],
    ] as const)
      if (
        n[key] !== undefined &&
        (!Array.isArray(n[key]) ||
          n[key].length !== length ||
          !n[key].every(Number.isFinite))
      )
        fail("Invalid node transform");
    for (const child of n.children ?? []) {
      if (!Number.isInteger(child) || !nodes[child] || parents.has(child))
        fail("Invalid model hierarchy");
      parents.set(child, i);
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    const visited = new Set<number>();
    let current = i;
    while (parents.has(current)) {
      if (visited.has(current) || visited.size > 128)
        fail("Cyclic or excessive model hierarchy");
      visited.add(current);
      current = parents.get(current)!;
    }
  }
  if (!json.scenes?.length || !json.scenes[json.scene ?? 0])
    fail("Model needs a valid scene");
  for (const scene of json.scenes)
    for (const node of scene.nodes ?? [])
      if (!Number.isInteger(node) || !nodes[node]) fail("Invalid scene node");
  if (triangles > 250000) fail("Model exceeds 250,000 triangles");
}
