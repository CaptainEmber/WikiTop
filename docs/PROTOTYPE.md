# Static WikiTop prototype

WikiTop is a Vite application served from a static host. It has no login, database, wiki service, object storage, or application server. The published world is the GLBs under `world/`; the catalog tool validates and copies them into the production artifact.

## Browser storage

Published Things are read-only. **Edit local copy** or **New Thing** starts an IndexedDB draft. Drafts autosave in that browser profile. **Export GLB** is the durable, shareable save operation. Clearing site data removes unexported drafts.

A v2 GLB contains one Thing. Opening an older v1 package splits its tree into one draft per Thing and turns containment into stable-ID placements. An ordinary GLB becomes one Thing with the original model as its 3D face.

## Commands

```sh
pnpm dev
pnpm validate
pnpm test
pnpm test:e2e
pnpm build
pnpm preview
pnpm diff:things A B
```

Set `WIKITOP_BASE=/repository-name/` to test a GitHub project-site base. The Pages workflow derives it from the repository name.

## GitHub Pages and limits

The Pages workflow validates and deploys `app/dist` from `main`. Select **GitHub Actions** as the Pages source in repository settings. Pull requests use read-only permissions; semantic changes appear in the job summary and a downloadable artifact.

Each Thing is limited to 25 MiB and editor media to 10 MiB. Keep a starter world below 250 MiB. Git LFS is absent because Pages does not publish LFS objects. Links resolve by stable Thing ID inside one repository. Live presence, chat, simultaneous drawing, and direct GitHub writes are deferred.

The former server prototype is preserved by the `legacy-server-prototype` tag.
