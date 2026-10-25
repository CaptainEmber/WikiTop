import type { Drawing } from "./index.js";
/** Input must pass DrawingSchema. Only numeric coordinates and validated hex colors enter SVG. */
export function drawingSvg(drawing: Drawing, width: number, depth: number) {
  let left = -width / 2,
    right = width / 2,
    bottom = -depth / 2,
    top = depth / 2;
  for (const stroke of drawing.strokes)
    for (const [x, y] of stroke.points) {
      left = Math.min(left, x - stroke.width / 2);
      right = Math.max(right, x + stroke.width / 2);
      bottom = Math.min(bottom, y - stroke.width / 2);
      top = Math.max(top, y + stroke.width / 2);
    }
  const extentWidth = right - left,
    extentDepth = top - bottom;
  const paths = drawing.strokes
    .map((s) => {
      const points = s.points.map(([x, y]) => `${x},${-y}`);
      const d =
        s.points.length === 1
          ? `M${points[0]}l0.001,0`
          : `M${points.join(" L")}`;
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, Math.round((2048 * extentWidth) / Math.max(extentWidth, extentDepth)))}" height="${Math.max(1, Math.round((2048 * extentDepth) / Math.max(extentWidth, extentDepth)))}" preserveAspectRatio="none" viewBox="${left} ${-top} ${extentWidth} ${extentDepth}">${paths}</svg>`;
}
