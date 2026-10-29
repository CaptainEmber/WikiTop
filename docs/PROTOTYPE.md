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

Each Thing is limited to 25 MiB and editor media to 10 MiB. Keep a starter world below 250 MiB. Git LFS is absent because Pages does not publish LFS objects. Links resolve by stable Thing ID inside one repository. Chat, voice, persistent campaigns, and direct GitHub writes are deferred.

## Private adventure preparation

Copyrighted adventure sources belong under `adventures/<slug>/source/`; normalized manifests and generated GLBs use the sibling `manifest/` and `generated/` directories. All three are ignored by Git. `npm run generate:adventure -- murkmire-malevolence` validates the local inputs and generates a collection of portable Things. In **My Things**, choose **Open GLB collection** and select every generated GLB; WikiTop saves the collection to IndexedDB and opens its adventure root.

The public `world/srd/` library contains only reusable SRD-attributed creature templates and original WikiTop tokens. Private adventure packs may link to those public templates. In Live Play, the host can right-click-move placed Things and track resources, conditions, or temporary visibility. Those instance overlays expire with the room.

The public `world/planes/` collection begins at `planar-system` and links through the Material Plane, its Feywild and Shadowfell echoes, Inner and Outer Plane indexes, and the Astral and Ethereal transitive planes. Plane entries intentionally use concise original summaries and name-only map labels so contributors can extend them with their own realms and artwork.

## Live play service

`services/room-worker` is an optional Cloudflare Worker with one SQLite-backed Durable Object per room. It uses hibernating WebSockets for authoritative movement, travel, host roles, and drawing. Rooms use random guest and reconnect secrets rather than accounts.

```sh
pnpm --filter @wikitop/room-worker dev
VITE_PLAY_URL=http://localhost:8787 pnpm dev
```

For deployment, add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub Actions secrets. Set the repository variables `CLOUDFLARE_DEPLOY_ENABLED=true` and `VITE_PLAY_URL` to the deployed Worker URL. Forks without these settings retain the complete solo world and editor and show Play as unavailable.

The room stores only compact temporary state. Local GLBs are relayed in verified 256 KiB chunks and are not stored by the Worker. An alarm deletes the room one hour after everybody disconnects. See [privacy notes](PRIVACY.md).

The former server prototype is preserved by the `legacy-server-prototype` tag.
