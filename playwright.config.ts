import { defineConfig } from "@playwright/test";
const port = Number(process.env.E2E_PORT ?? 3100);
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    launchOptions: {
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
    },
    reducedMotion: "reduce",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm build && pnpm --filter @wikitop/server start",
        port,
        reuseExistingServer: false,
        env: {
          NODE_ENV: "test",
          DEV_AUTH: "true",
          WIKI_MODE: "memory",
          APP_URL: `http://127.0.0.1:${port}`,
          PORT: String(port),
          DATABASE_URL: "",
        },
      },
  reporter: "list",
});
