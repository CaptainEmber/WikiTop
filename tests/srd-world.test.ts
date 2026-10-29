import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { importThingGlb } from "@wikitop/thing-format";

describe("public SRD Things", () => {
  it("ships reusable creatures with embedded original tokens and resources", async () => {
    for (const id of [
      "guard",
      "commoner",
      "noble",
      "animated-armor",
      "mimic",
      "allosaurus",
      "ankheg",
      "behir",
    ]) {
      const bytes = await readFile(`world/srd/srd-${id}.glb`),
        item = await importThingGlb(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
          `${id}.glb`,
        );
      expect(item.document.thing.kind).toBe("creature");
      expect(
        item.document.thing.statBlock?.resources.some((r) => r.id === "hp"),
      ).toBe(true);
      expect(item.document.thing.face.media.token?.kind).toBe("embedded");
      expect(item.media.size).toBeGreaterThan(0);
    }
  });
});
