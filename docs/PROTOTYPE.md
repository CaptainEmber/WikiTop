# WikiTop prototype setup and architecture

## What is implemented

Authors use one Thing workspace for places, characters, and nested contents. It edits a normalized Thing document, with adapters writing area prose and scene JSON to the existing Wiki.js pages and character drafts to their existing records. Publishing captures both sources in an immutable application record. Play uses those records exclusively, so a wiki outage or later draft edit does not alter a running session.

The first loop includes independently owned areas, scoped door invitations, explicit connection acceptance, private sessions, account-owned characters, movement, travel, chat, and a shared map/perspective renderer. Images support tokens, cards, billboards, and map surfaces. Images and self-contained static GLB models can be uploaded or referenced by HTTPS URL.

Vehicle travel, live stat editing, transfers between arbitrary containers or characters, portable PNG/GLB document export, simultaneous prose editing, live revision upgrades, public discovery, and advanced secrecy are deferred. Nested Thing data and transforms are supported. Each session uses area-local speech and session-wide OOC chat; no per-zone chat channel is claimed. Members can read retained OOC history and the retained speech history of their current area; per-recipient historical secrecy is deferred.

## Location, viewed spaces, and contents

Physical location and the viewed space are separate. **Enter yourself** or **Peer inside** opens the character/container in the main 2D/3D viewport without changing the joined character's placement, zone, or speech location. Nested bags use the same scene renderer, local X/Y positions with Z up, selectable tokens, labeled attributes, and optional artwork backgrounds.

The always-visible **Return to character** button opens the joined character's latest physical room, selects that character and centers the camera. It preserves the current camera mode and zoom. Selecting another token never changes this navigation anchor. Breadcrumbs and **Back** navigate parent views without travel. When viewing an interior, the header shows both the viewed space and the character's physical location. Only the viewed contents appear in its manifest; chat stays associated with physical location.

Left-click selects; right-click moves the selected, permitted direct child in the viewed space. Interior movement updates only that child's container-local position. Middle-drag pans in 2D or orbits in 3D; the wheel zooms. **Travel through** and **Travel inside** explicitly move the character. The older **Leave interior** action is physical return travel after entering a linked area; it is distinct from view-only Back and Return to character.

The session host controls the area's live Things. Owners control their own Things and can delegate scene-Thing or character control through the inspector. Selecting yourself in Controller revokes delegates. Character control includes arranging accessible, visible contents, but never bypasses read permissions or grants template editing rights.

**Visible** and **Peerable** are independent flags. Visible shows a Thing in its parent; Peerable allows opening it to inspect permitted children. A visible, non-peerable backpack shows its own name/art but exposes no children. Owners can inspect their own Things, including hidden items and closed containers. Other players must have access through every ancestor. Characters default to visible and peerable; inventory items default to private. Mark held equipment visible to show it to peers, and separately allow peering when its contents should be accessible. Selection shows descriptions, values, full artwork and permitted actions. Owners can change sharing flags in the live inspector without editing a template.

The server filters physical-room snapshots, viewed interiors, manifests, artwork access and session metadata before delivery. Control alone does not reveal private contents, even for a host. If a peer target leaves the joined character's physical room, disappears, or becomes hidden/closed, the server returns that connection's view to the joined character's location. Viewing your own interior stays open when your character moves or travels.

Authors opt loose items into public pickup with `portable: true`; a visible portable item in the actor's physical room can be taken. Maps and linked area pins cannot be taken. Peering never grants permission to take equipment from another character. Take adds a private live instance to the acting character's inventory. **Drop in [room]** places an owned portable item, including one inside a bag, at the joined character's physical position, regardless of the current view. Drop preserves visibility; enable Visible if other players should see the dropped item. Later pickups preserve live instance identity. Transfers between arbitrary containers or characters remain deferred. A conflicting legacy item ID rejects a drop atomically rather than duplicating an item.

A Thing's `visual` represents it in its parent; optional `imageAssetId` supplies full artwork. A character/container's optional `space` stores width, depth and a background asset. Defaults use the existing 20 × 16 scene dimensions; full artwork provides a fallback background fitted without stretching. All direct children can appear as tokens or labeled markers, including inventory and custom attributes. The unified Thing workspace provides a full-size viewport, nested navigation, background uploads/URLs, child editing, sharing flags and grid arrangement. These are template edits; character inventory/layout templates are copied on first session entry, and later template saves do not overwrite existing session copies. Appearance and description remain shared character profile metadata.

The separate `interiorAreaId` reference remains a physical travel link to a published area: a city can contain a Tavern pin that offers **Travel inside**. Session creation includes reachable published destinations only when the host has play access; the destination pins on first physical visit. View-only container navigation does not grant remote access to another area's publication or replace approved cross-owner door connections.

On startup and join, the server conservatively normalizes legacy live copies: missing inventory flags become private, legacy `contentsVisibility: "controllers"` becomes non-peerable to others, and overlapping/out-of-bounds interior positions receive a deterministic grid layout once. Existing live IDs and publications/hashes are preserved. New inventory copies receive unique instance IDs. Runtime ownership and instance-origin fields are server-assigned and rejected in authored JSON. That view-state migration required no SQL schema change; its fields live in existing JSONB records. The unified authoring phase below additionally introduces an identity-index table. Keep a database backup before upgrading. Layouts, sharing, ownership and positions persist with PostgreSQL; browser view navigation does not.

## View protocol

`ViewTarget` is either `{ kind: "location" }` or `{ kind: "interior", root: "character" | "area", rootId, path: [childId, ...] }`. A character root with an empty path opens that character. Area roots name the current physical area and require a container path. Root and path scope local IDs; bare child IDs do not identify a remote space.

Socket `subscribe` accepts optional `viewTarget`; Socket `view` accepts `{ sessionId, characterId, viewTarget }` and acknowledges a fresh authorized snapshot. Navigation does not write placements, emit play events, or consume command operation IDs. The server stores the target on that connection and revalidates it on every outgoing snapshot. Explicit unavailable navigation returns `view_unavailable`; an invalid reconnect target or an invalidated subscription falls back to location. Reconnect retains the browser's requested view; a full reload starts at location.

`PlaySnapshot.view` contains the canonical target, name, breadcrumbs, projected scene, artwork background and permitted action IDs. The physical `scene`, placement, publication metadata and messages remain available separately. HTTP snapshot reads default to the physical location view. Snapshot `publication.scene` is an authorized physical projection, not an export of the immutable source record; its stored source hashes remain provenance metadata. Raw publications stay unchanged in the database.

Interior `interact` movement and sharing commands include `viewTarget`, the session live revision and the direct child's `targetId`; the server checks the referenced space, visibility, control/ownership and bounds before committing. Commands remain transactional, deduplicated and distributed through the outbox. Navigation cannot authorize a transfer or change where speech occurs.

## Editing in the local preview

The **Wiki** link opens an authenticated article index in the local memory demo. Select one of your articles, edit its Markdown, and click **Save article**. Owners and explicitly granted collaborators can save; a connection or play-sharing grant does not permit editing. This updates the draft only. Use **Publish snapshot** in the area editor to publish it for future sessions. Hosted installations continue to link to the configured Wiki.js instance.

In **Characters**, open a character card or the large **+ New character** card. Characters, places, and nested Things open the same workspace. Draft edits autosave after 800 ms and on field blur/navigation; **Save now** flushes pending work. Live inventory copies remain separate from authored drafts.

The scene editor calls map surfaces **Background**, including its add button and the default name for a newly created background. The stored visual mode remains `map` for compatibility.

## Repository and data flow

- `packages/shared`: runtime schemas, types, scene validation, and zone membership.
- `apps/server`: HTTP, OIDC login, wiki adapter, authoritative commands, assets, database, and outbox.
- `apps/web`: Thing library and unified authoring workspace, invitations, private sessions, and renderer.

Wiki.js is accessed only through its GraphQL API. The integration targets **Wiki.js 2.5.315**, not the incompatible 3.x beta API. `pnpm wiki:check` checks required page, group, and user operations. GraphQL credentials never reach the client.

Authoring flow: browser → authenticated application API → ownership check → Wiki.js scene page. Play flow: browser command → authorization and revision checks → PostgreSQL transaction with outbox event → filtered session snapshot over Socket.IO. Reconnect always fetches a new snapshot.

PostgreSQL uses separate tables for accounts, area registry, publications, invitations, connections, characters, placements, sessions, messages, assets, login attempts/sessions, operation receipts, and outbox events. Records use JSONB payloads. Separate transaction-scoped advisory locks serialize live commands and authoring writes. A slow wiki request cannot hold the live-command lock; record-level diffs preserve changes committed by the other subsystem. Wiki scene saves remain serialized. This favors correctness at the ten-player prototype scale; it is not the final high-volume storage design. Reads use repeatable-read snapshots.

A wiki save and a PostgreSQL commit cannot be one distributed transaction. If a save succeeds but the database commit fails, the next read detects a scene revision/hash mismatch and refuses further publication or saves. Restore the last agreed scene page through Wiki.js history, or reconcile its revision/hash administratively after inspecting both records. Do not silently overwrite the conflicting page.

## Configuration

Copy `.env.example` to `.env`. Generate distinct URL-safe secrets, for example with `openssl rand -hex 32`, for all database passwords, both OIDC clients, Keycloak admin, and S3 storage. Never commit `.env` or user provisioning input. Hosted Compose maps its environment explicitly; host-run commands need exported variables (`set -a; . ./.env; set +a`).

Set `PLAY_HOST`, `WIKI_HOST`, `AUTH_HOST`, and `ACME_EMAIL` to real hostnames and an email. Point all three DNS records at the staging server and allow inbound TCP 80/443 and UDP 443 if using HTTP/3. Allocate approximately 4 CPU cores and 8 GiB RAM for the private stack, then measure actual usage.

Keep ports 5432, 8080, and 9000 private. SeaweedFS provides the bundled S3 endpoint. Its management interfaces are not published. Assets stay in a private bucket and are served through an authorization-checking application route.

## Start dependencies and initialize Wiki.js

```sh
docker compose up -d wiki keycloak storage caddy
```

Open `https://wiki.YOUR_DOMAIN` and finish Wiki.js setup with a separate administrator account and the HTTPS wiki URL. This bootstrap administrator is for wiki administration, not ordinary play.

In Wiki.js Administration:

1. Disable guest page access and remove broad editing grants from default/authenticated groups. Ordinary authors must not inherit `manage:system`, `manage:pages`, or unrestricted `write:pages` grants.
2. Enable API access and generate a server-only integration API key. It needs source/page read, `manage:pages` (required by the Wiki.js 2.x single-page management query), page write, user read/provisioning, and group management rights. Store it as `WIKI_API_KEY`. Use a full-access key only within this private prototype if granular integration grants are impractical.
3. Add **Generic OpenID Connect / OAuth2** authentication. Record the exact strategy instance key as `WIKI_AUTH_PROVIDER_KEY`; it may be a generated ID, not the literal `oidc`.
4. Use client ID `wiki`, `WIKI_OIDC_CLIENT_SECRET`, and issuer `https://auth.YOUR_DOMAIN/realms/wikitop`.
5. Set authorization, token, and user-info URLs to the issuer plus `/protocol/openid-connect/auth`, `/protocol/openid-connect/token`, and `/protocol/openid-connect/userinfo`. Use `email` for the email claim and `name` for the display-name claim. Disable group mapping, self-registration, and automatic enrollment into privileged groups.
6. Keep the local administrator strategy enabled for maintenance. Test normal author accounts separately.

The imported wiki client permits callbacks under `/login/*`; after recording the wiki strategy key, you can narrow it to that exact `/login/STRATEGY_KEY/callback` URL. The imported Keycloak realm disables public registration and defines separate confidential clients for Wiki.js and WikiTop. WikiTop uses authorization code plus PKCE, nonce/state verification, issuer/audience/signature validation, and verified email. Its random session token is stored hashed in PostgreSQL and sent in an HTTP-only cookie. Production cookies require HTTPS. Keycloak subjects, not email addresses, are the application identity keys.

## Build and initialize play

```sh
docker compose build play
docker compose up -d play
docker compose exec play pnpm wiki:check
docker compose exec play pnpm --filter @wikitop/server storage:init
```

Migrations create missing tables on application startup; the migration CLI can also run explicitly. They never clear data. Once configured, both the play app and wiki should redirect normal users to the same Keycloak realm.

### Provision users

Create a private JSON file, outside the repository, containing objects with `email`, `name`, and `temporaryPassword` (at least 12 characters). The provisioning tool creates verified Keycloak users with temporary passwords, wiki users tied to the configured provider, and application identity records. It does not reset existing users' passwords.

Run it from a host with Node, access to the databases and public identity/wiki endpoints, exported configuration, `KEYCLOAK_ADMIN_PASSWORD`, and `PROTOTYPE_USERS_FILE` pointing to that file:

```sh
pnpm --filter @wikitop/server users:provision
```

For hosted use without a host Node installation, copy the private input into the play container, execute the same command with `PROTOTYPE_USERS_FILE` and Keycloak admin credentials supplied securely, then delete the input. Do not put secrets directly into committed command files.

Provisioning, and idempotently each area creation, configures an author-specific wiki group: read access under `wikitop`, write access only under `wikitop/articles/ACCOUNT_ID/`. Scene pages under `wikitop/scenes/` remain integration-writer-only. Authors may read each other's drafts. New users must have matching verified identities; the adapter fails closed if the wiki account/provider mapping is missing.

Additional wiki collaborators can be granted explicit article page rules by a wiki administrator. The prototype UI exposes connection invitations, not collaborator editing grants. Do not add broad page editing rights to make invitations work.

### Seed the two example areas

After at least two provisioned accounts exist in both systems:

```sh
docker compose exec -e SEED_EMAILS=mara@example.com,rowan@example.com play pnpm seed
```

The seed refuses to add duplicate demo content to a database that already contains areas. It creates distinct area owners, accepted forward and return connections, publications, characters, and a shared private session. A normal author can also start from an empty library.

## Local Docker configuration

For the real stack on one development machine:

```sh
docker compose -f compose.yaml -f compose.local.yaml up -d play-db wiki keycloak storage
```

Use Wiki.js at `http://localhost:3001`, Keycloak at `http://localhost:8080`, and export `.env` for a host-run application on port 3000. Point `DATABASE_URL` to localhost:5432, `WIKI_INTERNAL_URL` to localhost:3001, and storage to localhost:9000. Local Compose publishes dependency ports on loopback only. Set `DEV_AUTH=false`, `WIKI_MODE=remote`, and make the database URL password match `PLAY_DB_PASSWORD`.

For Wiki.js's local OIDC strategy, use the browser-facing authorization URL at localhost:8080, but token and user-info URLs at `http://keycloak:8080/realms/wikitop/protocol/openid-connect/...` because Wiki.js runs inside Docker. Keep the issuer browser-facing. For a containerized local play app, Compose provides a separate internal OIDC URL while retaining the public issuer.

Import substitutions occur when a realm is first created. Editing environment secrets later does not update existing Keycloak clients; update those clients explicitly in the admin console.

## API and live protocol

HTTP endpoints require a login cookie. Mutations also require the configured browser Origin. Bodies reject unknown fields.

| Interface                                              | Actions                                                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/areas`                                           | List through library; create a wiki-backed area                                                                                                       |
| `/api/areas/:id/draft`, `/scene`, `/publish`, `/share` | Load draft, revision-checked save, immutable publication, play-sharing grant                                                                          |
| `/api/invitations` and `/:id/propose`, `/:id/accept`   | Invite an existing author, propose an owned target, accept                                                                                            |
| `/api/connections/:id/disable`                         | Either endpoint owner can disable travel immediately                                                                                                  |
| `/api/sessions` and membership routes                  | Create private sessions, invite/remove players, join/leave with an owned character                                                                    |
| `/api/characters`, `/api/assets`                       | Create a character; upload a validated image                                                                                                          |
| `PATCH /api/characters/:id`                            | Owner-only character template/profile editing                                                                                                         |
| `/api/sessions/:id/snapshot/:characterId`              | Authorized current snapshot                                                                                                                           |
| Socket `subscribe`                                     | `{ sessionId, characterId, viewTarget? }`; acknowledgment includes a fresh snapshot                                                                   |
| Socket `view`                                          | Authorized per-connection view navigation without movement                                                                                            |
| Socket `command`                                       | Move, travel, chat, or `interact` (move/take/drop/enter/exit/control/flags), with operation ID, revision and scoped view context for interior actions |
| Socket `snapshot`, `revoked`                           | Current authorized view or immediate loss-of-access notification                                                                                      |

Socket acknowledgments use `{ ok: true, ... }` or `{ ok: false, error: { code, message } }`. HTTP errors use `{ error: { code, message } }`. Reuse the same operation ID only to retry the same live command. The client does not automatically retry a timed-out command; reconnect reveals whether it committed. HTTP authoring requests are revision checked where applicable but do not provide generic idempotency keys.

Published source and target endpoint hashes must match an approved connection. Session creation follows approved links from the selected areas and includes reachable published destinations that the host has permission to play. Disabled links, unpublished destinations, mismatched published endpoints, and areas without host play access are excluded. The host must retain destination play access. Existing sessions keep their original area selection. The first area pins immediately; later destinations pin on first visit. Return travel requires a separate invitation and approval. An accepted proposal also shares its target with the source owner for hosting private sessions; it never grants editing access.

## Checks, operations, and recovery

`pnpm test` covers permissions, stale revisions, duplicate commands, publication isolation, wiki outages, invalid images, travel failure, and zone membership. `TEST_DATABASE_URL` enables a disposable PostgreSQL integration test, which truncates its own WikiTop tables. Never point it at production.

`pnpm test:e2e` builds and starts the ephemeral demo, then exercises multiple browser identities, map/perspective rendering, movement, travel, invitations, scene saving, and publication isolation. `RUN_SOCKET_TESTS=true` enables the ten-player socket/reconnect test. `S3_TEST_ENDPOINT`, `S3_TEST_ACCESS_KEY`, and `S3_TEST_SECRET_KEY` enable real private-object storage checks. `WIKI_TEST_URL` / `WIKI_TEST_API_KEY` enable the real adapter suite against an isolated wiki; it creates test users and pages. Run the opt-in shared-login browser check with `SSO_PLAY_URL`, `SSO_WIKI_URL`, `SSO_EMAIL`, and `SSO_PASSWORD` against staging.

Health endpoints: `/health` is process liveness; `/health/ready` checks database access independently of the wiki. Authenticated `/api/operations` reports pending outbox count and oldest pending timestamp. Review structured application logs and alert on sustained backlog or repeated command failures. Authoring reports wiki outages without stopping published sessions.

Run `scripts/backup.sh /secure/backup/path` from the Compose directory for database dumps and a stopped-writer asset copy. Encrypt and separately back up `.env`. Restore into a stopped staging stack: restore each dump with `pg_restore --clean --if-exists --no-owner` against its matching database; replace the stopped storage container's `/data` from the asset copy; restore configuration; restart dependencies and play. Validate sign-in, a publication, its images, and persisted placement before accepting users. Practice this on staging before relying on backups.

Deploy new builds to staging first. Run HTTPS login and browser acceptance checks before invitations. No staging host or DNS was supplied for this implementation, so remote deployment is an operator step.

## Coordinate convention and existing data

Scene schema version 2 uses **Z up**: X increases to the right, Y increases toward the top of the map, and Z is elevation toward the top-down camera. Ground movement and rectangular zones use X/Y; the inspector exposes X, Y, and Z for Things and endpoints. Area width spans X and depth spans Y. Three.js cameras use this convention directly; glTF models retain their standard Y-up asset coordinates and are rotated at the model boundary.

Version 1 was Y-up. Before upgrading an existing persistent installation, stop play and pause wiki edits, take a database/wiki backup, then run `pnpm migrate:coordinates` using the configured integration environment. For Docker, use a one-off play container with a persistent private backup mount, for example `docker compose run --rm -e COORDINATE_BACKUP_FILE=/backup/z-up.json -v "$PWD/.data:/backup" play pnpm migrate:coordinates`. Ensure `.data` exists and the container's user can write it. Restart play after the migration succeeds.

The migration rotates `[x, y, z]` to `[x, -z, y]`, including nested transforms, zone centers, arrival points, live placements, publications, and approved endpoint hashes. It preserves area IDs, publication IDs, and session pins. Existing published snapshots are converted as a one-time format upgrade. Missing stale endpoints disable their connections. A private recovery file records the original database and wiki scene sources; retry with the same file if interrupted. The command refuses unexpected source or database changes. Keep that file secure because it includes account/session records. The new server refuses legacy publications instead of rendering them with incorrect axes.

### Library navigation and tags

The top navigation separates **My Content** (owned articles and places), **Shared with Me**, **Characters**, **Sessions**, and **Connections**. Shared content retains its existing editing and play permissions.

Articles, character templates, and nested Things support up to 20 free-form tags, each up to 32 characters. Tags are normalized to lowercase and deduplicated. Suggested labels include character, setting, item, and vehicle; labels do not assign mechanics or permissions. Article tabs can filter by tag. Use **Edit tags** on an article, the character editor, or a selected Thing’s inspector to edit labels. Article tags are captured when publishing; changing draft tags does not modify earlier publications. Legacy records can omit tags. WikiTop manages article tags in its registry; these do not sync to Wiki.js’s native tag system.

### Generated article exits

Use **Read article** on a library article to open its published prose and generated **Exits** section. Exit names link to destination articles when the approved connection is enabled, both published endpoints still match, and the reader has access. Unconnected doors show **Unexplored**; disabled, stale, or inaccessible connections show **Unavailable** without destination details. Browsing never places or moves a character.

Live play shows separate destination article links and **Travel via …** buttons. Session article links retain session context, use pinned publications when available, and authorize reads through session membership and the host’s area grants. Browsing an unvisited destination does not pin it; physical travel pins its publication as before. Disabled connections are checked on every article request and travel command. An already-open article is refreshed by reloading it.

`GET /api/areas/:id/article?sessionId=…` returns published prose and an authorized exit catalog without accessing Wiki.js. In the local memory wiki, the prose editor displays the same generated exits below the draft form. With external Wiki.js, the catalog lives in WikiTop’s published article reader; it does not rewrite Wiki.js prose or native backlinks. No public article discovery is added.

### Building beyond an unexplored exit

A saved, unconnected door offers **Create destination article / Thing** and **Generate invitation link** to the source owner, in the scene editor or its published article’s exit catalog. Creation makes an owned draft area with wiki prose, a scene, and an arrival anchor. Add nested Things in that destination’s editor. Owner-created destinations connect immediately but remain unpublished; publish both endpoints before travel. This creates a new space, not a portable inventory item, and does not automatically add a return exit.

Other authorized readers can **Request permission to create** from an unexplored published exit. Requests appear in **Connections**. The source owner approves or declines; approval allows creation of one owned destination draft and its nested Things, not source editing. The draft submits an arrival proposal. The source owner still explicitly accepts that connection. After editing a proposed destination scene, submit its current arrival anchor again using Connections before acceptance.

Invitation URLs (`/contribute/:id`) require an existing signed-in account and explicit **Claim invitation**. A link can be claimed by one account; the same account can revisit before creating its draft. Claims do not grant source editing, publication, session admission, or acceptance rights. The source owner can revoke pending invitations or proposals in Connections. Saved source revision and endpoint checks reject stale links and requests. Creating a destination uses the authoring transaction and never changes live placements or existing session pins. Revocation leaves already-created independently owned drafts intact. Grants apply to the chosen exit; they do not recursively grant permissions over other authors’ content.

HTTP operations: `POST /api/areas/:id/exits/:doorId/create` (`name`, optional `invitationId`), `/invite-link`, `/request` (optional `sessionId`); `POST /api/invitations/:id/claim` and `/resolve` (`approve`). Link secrets stay in authenticated owner/recipient views; do not publish invitation URLs as ordinary article links. Login preserves allowed local contribution/article destinations, rejecting external redirect targets.

## Unified Thing documents and authoring workspace

`ThingDocument` schema version 1 contains `rootId`, a map of globally identified nodes, and parent-child placements with local position, quaternion rotation, and scale. Nodes share prose, tags, media, visibility, and optional space/attribute/character capabilities. Character capability is explicit; a tag does not make a Thing playable. A space contains dimensions, zones, exits, and arrival anchors. The document contract is independent of storage and contains no editable ownership/controller grants.

### Standalone portable editor

Run `pnpm build:portable` to create `apps/web/dist-portable/index.html`. The directory is a static artifact with relative asset paths and can be copied directly to GitHub Pages or another static host. For development, run `pnpm --filter @wikitop/web dev:portable` and open `/portable.html`. The page has no login, API, wiki, WebSocket, or application-server dependency.

The browser stores local drafts and their media in the `wikitop-portable-things` IndexedDB database. It restores the last open draft and autosaves after edits. Browser storage is a working copy rather than a backup: **Export GLB** downloads the durable shareable copy. The local draft home can open, duplicate, download, and delete drafts.

A portable Thing is one GLB containing its complete descendant tree. `asset.extras.WikiTop` holds a versioned `wikitop-thing` manifest with the normalized document, media hashes and buffer-view references, plus bindings from Thing IDs to ordinary glTF preview nodes. Original PNG, JPEG, WebP, and source GLB bytes occupy aligned binary buffer views; they are never expanded into base64 JSON. The generated glTF scene mirrors the containment hierarchy so ordinary viewers show a spatial preview. WikiTop uses the manifest and original media for lossless editing.

**Open GLB** replaces the current working document after an unsaved-work warning. **Insert GLB** adds its root below the viewed Thing and remaps colliding Thing, layout, drawing, and media identities. **Export selected Thing** extracts that Thing and all descendants into an independent GLB. An ordinary GLB without WikiTop metadata imports as one model Thing. Ownership, controllers, sessions, chat, permissions, and live character locations are not portable fields.

Packages are limited to 100 MiB; individual media retains the existing 10 MiB limit, images are limited to 4096 × 4096, and imported models use the existing static core-GLB checks. Import validates the manifest, containment, hashes, MIME signatures, buffer ranges, bindings, transforms, and model complexity before replacing the current draft. HTTPS media must be fetched successfully through browser CORS and embedded before export. The static editor never leaves mutable remote media links in a downloaded package.

`GET /api/things/:id/document` returns the document, content revision, and server-derived authoring/publication permissions. Owners and granted area editors receive drafts; other permitted area readers receive a filtered published document. Private or closed descendants are not returned. Character authoring remains owner-only. `PUT` accepts the document, expected revision and operation ID; it serializes saves, deduplicates retries, and rejects conflicts. `POST /api/things` accepts a `character`, `place`, `item`, or `container` preset and a name. Non-character roots currently use the area adapter and retain a space; changing an area's root into a character or vice versa is explicitly unsupported.

The adapters keep existing area/character records authoritative. Legacy child IDs map deterministically into global authoring IDs; the `thingIds` metadata index reserves IDs to a document without duplicating its content. New child IDs use a `thing_` prefix and UUID. Reparenting within a document preserves identity and local transforms. Existing wiki endpoint IDs, publications and live copies are not rewritten. Database installations must run **`pnpm db:migrate`** before this upgrade to create `wt_thingids`; the memory store fills missing collections when restoring older checkpoints. No individual child wiki pages are created in this phase.

The full-size workspace opens nested contents in the main 2D/3D viewport. Back/breadcrumbs change the authoring view, not physical placement. Camera state is retained per space and mode. Left-click selects; right-click positions an editable direct child in XY while retaining its Z elevation. The inspector edits all Thing types, their relative transforms, media, spaces, and layout components. **Article** shows prose and linked child entries with relative coordinates; **Document** shows the authorized normalized JSON. These previews are read-only representations; they prepare later wiki/export work. The old character form and mini interior editor have been removed. Session joining selects a character card.

Autosave status distinguishes Saved, Saving, Offline and Conflict. Pending drafts are cached per browser/account/root and retried when online. Concurrent saves are never silently merged or overwritten. **Copy local document** preserves a conflicted local copy; **Reload latest draft** archives the local document in browser storage and loads the server version. Browser storage is a recovery aid, not a server backup. Do not clear it while recovering unpublished edits. Area publishing remains explicit; current character profile behavior and session-copy isolation remain intact. Live group editing, Git persistence, child articles, portable metadata exports, and drawing are later phases.

### Media support

Each node independently references a token, full artwork, background, and model. Stored references identify authorized assets; external references retain HTTPS URLs and declared image/model type. Upload or **Use URL** in the inspector. Uploaded PNG/JPEG/WebP keep their existing 10 MiB / 4096 × 4096 limits. Models must be self-contained core GLB 2.0, at most 10 MiB and 250,000 triangles, with embedded PNG/JPEG textures. Animation, skins, sparse accessors, non-triangle primitives and glTF extensions/compression are not supported yet. Embedded texture dimensions remain limited to 4096 × 4096. Model metadata is never imported as Thing content or permissions.

Hotlinks load in the browser and require CORS. WikiTop does not fetch arbitrary URLs on the server. External GLB bytes are checked before loading; resource URIs and unsupported extensions are rejected, preventing secondary model downloads. External references are mutable and not archived into publications. Failed/oversized media shows a labeled fallback while the inspector and document remain usable. Model/texture resources are disposed after their last viewer releases them. Uploaded asset URLs remain authenticated and private; media used by a permitted authoring or published document can be read without joining a session.

The existing private local preview now writes atomic development checkpoints every five seconds and on graceful shutdown, including uploaded model/image bytes and remote references. Its recovery file is `.data/workspace-preview/state.json`, mode 600. This is a local demo safeguard, not a replacement for PostgreSQL/object-storage backups. The preview was stopped before the unified-workspace upgrade; recovery used the newest available saved checkpoint, so intervening uncheckpointed memory-only edits cannot be recovered.

## Live shared drawing

Every viewed space has a session-local drawing board: rooms, character interiors, and nested containers. The space owner can draw immediately and use **Enable shared drawing** to let current session viewers contribute. Drawing permission does not grant template editing, item control, or ownership. Closed and hidden interiors retain their normal access restrictions.

Use **Draw** for freehand ink, color, thickness, or whole-stroke erasing. **Select** restores normal token selection and right-click movement. Middle-drag camera navigation still works while drawing. Named cursors and transient stroke previews show collaborators working in the same space, in either camera mode. Contributors erase and undo their own strokes; the owner can erase any stroke and clear the board. Undo/redo preserves unrelated strokes and reports conflicts rather than overwriting subsequent work.

**Save drawing to draft** is owner-only and patches just the drawing component of the originating authored Thing. It retains the background, prose, objects, inventory and placements. Publish separately through the Thing workspace; current session pins stay unchanged. The workspace renders saved ink and includes its editable data in Document view and the scene-definition wiki JSON. Source-document and board revisions protect against stale saves; an independently changed authored drawing also blocks replacement. The session copy remains available after a failed save. Imported or transferred spaces without a reliable source mapping cannot overwrite authored Things.

Completed strokes, enablement, and the last 50 undoable operations per board persist in session records and private preview checkpoints. Unsaved ink stays with that session, rather than becoming public or appearing in another session. Cursors and unfinished strokes are temporary and expire after inactivity. Reconnect loads a fresh authorized snapshot; unfinished strokes are not recovered.

The shared version-1 drawing format stores stroke IDs, account attribution, validated hex colors, widths in meters, and local XY point arrays. SVG paths are generated from this structured data; arbitrary SVG input is not accepted. SVG-compatible stroke outlines are triangulated into vector geometry above the background and below tokens in both camera modes. They do not require a background image and stay sharp without allocating a giant canvas texture. Defaults: 300 strokes, 512 points per stroke, 30,000 points per board, and 50 retained history operations. Preview samples are limited to 64 points and approximately 14 updates per second per active artist; packet loss cannot corrupt committed strokes. Long gestures stop adding points at the stroke limit; start another stroke to continue.

Socket.IO `command` accepts drawing operations with operation ID, resolved board ID, view target and revision. Strokes merge independently; destructive operations require the current board revision. `drawing-preview` carries ephemeral cursor and sampled-stroke data, independently of durable outbox snapshots. `POST /api/drawings/save` requires the session, character, view target, board ID/revision, expected draft revision and operation ID. No additional database table or historical-publication migration is required. Wiki outages affect saving, not drawing or previously published play.

### Current characters

Character cards in **Characters** and **Sessions** have independent **Current character** checkboxes. Check several to bring them into a session together. Choices persist per account in this browser, including an intentionally empty selection. Selecting a session character card also makes that character current and chooses it as the viewing anchor; the remaining checked characters join alongside it. Unchecking a character changes future joins and does not remove a token already in play. **Enter** is disabled with no current characters.

Group joining uses `POST /api/sessions/:id/join-characters` with `characterIds` (one to fifty owned character IDs). Admission is atomic: an unauthorized character or one placed in another session rejects the group without changing placements. Already-joined characters remain at their existing locations. The original single-character join endpoint remains supported.


### Extended drawing canvas

Drawing is independent of the map or background rectangle. Each space supports a **20 km × 20 km** canvas, from −10,000 to +10,000 meters on local X and Y, even with no background image. Middle-drag pans in 2D; the existing 3D camera controls and expanded zoom range support exploring beyond the map. The map and the space's dimensions remain unchanged; token movement retains its existing bounds. Return to character recenters the view.

Ink uses vector stroke geometry with per-stroke local origins, so distant marks do not reduce nearby drawing resolution. Committed strokes and live previews share coordinate validation. Stroke count, point and undo-history limits still apply. Saved documents keep the original point coordinates; generated SVG view boxes include both the map rectangle and all ink, avoiding clipping off-map strokes. This is a large finite canvas rather than unlimited storage or unrestricted numerical coordinates.

### Compact live navigation

While a character is active, its name appears in the main header as the **Return to character** button. It opens the character's latest physical location, selects them and recenters the view. The adjacent **Swap character** button opens your character cards in selection mode; choosing a card joins that owned character to the current session and switches the viewing anchor. Other characters retain their placements. Cancel returns to the current character, and current-character checkboxes remain independent group-join preferences.

The bar below the header contains only viewed-space breadcrumbs. Use any ancestor breadcrumb to look outward. Session/status headings, the repeated interior title and physical-location text, Back, the zone badge, the separate Return button and Leave session are removed from that bar. Connection status remains available on the play workspace state. Physical Leave interior travel, when relevant, is available in the sidebar. This UI change does not alter character capabilities or scene-embedded NPCs.
