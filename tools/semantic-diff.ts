import { execFileSync } from "node:child_process";
import { importThingGlb, type ThingDocument } from "@wikitop/thing-format";
const base = process.argv[2] ?? "HEAD^",
  head = process.argv[3] ?? "HEAD";
const names = execFileSync(
  "git",
  ["diff", "--name-only", base, head, "--", "world/**/*.glb"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean);
const read = async (ref: string, path: string) => {
  try {
    const b = execFileSync("git", ["show", `${ref}:${path}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return (
      await importThingGlb(
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        path,
      )
    ).document;
  } catch {
    return undefined;
  }
};
const summary = (d?: ThingDocument) =>
  d
    ? {
        id: d.thing.id,
        name: d.thing.name,
        kind: d.thing.kind,
        tags: d.thing.tags ?? [],
        statBlock: d.thing.statBlock,
        placements: d.thing.page.placements.map((p) => ({
          id: p.id,
          targetId: p.targetId,
          position: p.position,
          hidden: Boolean(p.hidden),
        })),
        strokes: d.thing.page.drawing?.strokes.length ?? 0,
        media: Object.keys(d.thing.face.media).concat(
          d.thing.page.background ? ["background"] : [],
        ),
      }
    : undefined;
let markdown = "# WikiTop semantic diff\n\n";
for (const path of names) {
  const before = summary(await read(base, path)),
    after = summary(await read(head, path));
  markdown += `## ${path}\n\n\`${before ? (after ? "modified" : "removed") : "added"}\`\n\n\`\`\`json\n${JSON.stringify({ before, after }, null, 2)}\n\`\`\`\n\n`;
}
if (!names.length) markdown += "No Thing files changed.\n";
console.log(markdown);
