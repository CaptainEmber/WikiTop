# WikiTop

An authored wiki underneath a shared, live world. Build areas, invite a friend to create what is behind a door, publish, and play together in map or perspective view.

The prototype implements Wiki.js-backed articles and scene definitions, immutable publications, scoped connection invitations, private sessions, character movement and travel, chat, image tokens/cards/maps, a bundled GLB, and shared Keycloak login. See [DESIGN.md](DESIGN.md) for the product direction and [the prototype guide](docs/PROTOTYPE.md) for deployment and boundaries.

## Try the interface locally

Requires Node.js 22 and pnpm 10.6.5:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
DEV_AUTH=true WIKI_MODE=memory APP_URL=http://localhost:3000 pnpm --filter @wikitop/server start
```

Open **http://localhost:3000**. Choose Mara or Rowan; use separate browser profiles to play together. The demo includes Emberheart Tavern, Rowan's Basement, approved connections, and a private session. This mode is intentionally ephemeral and bypasses Wiki.js and Keycloak. It is forbidden in production. Do not expose it publicly.

To edit the UI with Vite, run the server on port 3000 and `pnpm --filter @wikitop/web dev` separately, using `APP_URL=http://localhost:5173` on the server. The Vite proxy keeps browser requests on one origin.

## Run the real stack

Follow [docs/PROTOTYPE.md](docs/PROTOTYPE.md) to configure Wiki.js, Keycloak, PostgreSQL, private asset storage, and HTTPS. Docker Compose includes local and hosted configurations. Hosting requires your server and DNS; the repository does not deploy automatically.

## Verify

```sh
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

Set `TEST_DATABASE_URL` to a **dedicated disposable database** to include persistence tests. Those tests truncate WikiTop tables in that database. Set `WIKI_TEST_URL` and `WIKI_TEST_API_KEY` to include remote wiki tests after configuring an isolated test wiki.

The browser suite launches the built ephemeral demo automatically. Real shared-login validation is a separate opt-in suite described in the guide. See [recorded validation results](docs/VALIDATION.md).
