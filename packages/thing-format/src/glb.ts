const MAGIC = 0x46546c67;
export function validateGlb(input: ArrayBuffer) {
  if (input.byteLength < 20) throw new Error("GLB is too small");
  const v = new DataView(input);
  if (v.getUint32(0, true) !== MAGIC || v.getUint32(4, true) !== 2 || v.getUint32(8, true) !== input.byteLength) throw new Error("Invalid GLB 2.0 header");
}
