import { defineConfig } from "@playwright/test";
const port = Number(process.env.PORTABLE_E2E_PORT ?? 3111);
export default defineConfig({
  testDir: "tests/portable-browser",
  workers: 1,
  timeout: 45000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure", launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] } },
  webServer: { command: `pnpm build:portable && pnpm --filter @wikitop/web exec vite preview --config vite.portable.config.ts --host 127.0.0.1 --port ${port}`, port, reuseExistingServer: false },
  reporter: "list",
});
