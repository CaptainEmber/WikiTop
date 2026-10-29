import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir:"tests/browser",testMatch:"play-live.spec.ts",workers:1,timeout:45000,
  use:{baseURL:"http://127.0.0.1:3100",trace:"retain-on-failure",launchOptions:{args:["--enable-unsafe-swiftshader","--use-angle=swiftshader"]}},
  webServer:[
    {command:"npx --yes node@22 services/room-worker/node_modules/wrangler/bin/wrangler.js dev --config services/room-worker/wrangler.jsonc --port 8787",url:"http://127.0.0.1:8787",reuseExistingServer:false,timeout:120000},
    {command:"VITE_PLAY_URL=http://127.0.0.1:8787 pnpm --filter @wikitop/app dev --host 127.0.0.1 --port 3100",url:"http://127.0.0.1:3100",reuseExistingServer:false,timeout:120000},
  ],
  reporter:"list",
});
