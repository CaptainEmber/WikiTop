import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], setupFiles: ["tests/setup.ts"], testTimeout: 15000 },
  resolve: { alias: { "@wikitop/thing-format": new URL("./packages/thing-format/src/index.ts", import.meta.url).pathname, "@wikitop/play-protocol": new URL("./packages/play-protocol/src/index.ts", import.meta.url).pathname } },
});
