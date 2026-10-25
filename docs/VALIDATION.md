# Prototype validation

## Portable Thing editor

- `pnpm build:portable` type-checks the shared format and browser editor, then emits a static `apps/web/dist-portable/index.html` artifact with relative asset paths.
- `tests/portable-glb.test.ts` verifies semantic document and byte-identical media round trips, namespaced manifests, ordinary glTF preview structure, generic-model import, subtree extraction, collision-safe insertion, Z-up conversion, and damaged-media rejection.
- Browser acceptance creates a local Thing, adds nested containers and media, reloads it from IndexedDB, navigates the complete hierarchy, exports the root and a subtree, reopens them, and inserts one under another. It runs against the static artifact without the WikiTop server.

Validated locally on October 20, 2026 using Node.js 22.14.0 and pnpm 10.6.5.

| Check                                                 | Result                                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Workspace type checks and production web/server build | Passed                                                                                                          |
| Full Vitest suite with optional integrations enabled  | 30 passed                                                                                                       |
| PostgreSQL 16.8                                       | Transactions, deduplication, rollback, pool restart, and concurrent authoring/live isolation passed             |
| Wiki.js 2.5.315                                       | Real page creation, scene saving, publishing, native author write restrictions, and shared draft reading passed |
| Keycloak 26.1.4                                       | Browser sign-in across play and wiki without a second password passed                                           |
| SeaweedFS 3.85                                        | Image validation, authenticated S3 persistence, and anonymous-access denial passed                              |
| Live sockets                                          | Ten identities, concurrent movement, reconnect, and membership revocation passed                                |
| Playwright demo flows                                 | Three passed: multiplayer play; author invitation/connection; editor save/publication isolation                 |
| Browser rendering                                     | Map and perspective switching passed without page errors; map visually inspected                                |
| Docker Compose                                        | Hosted and local configurations validated; image built and served the demo as a non-root user                   |
| User provisioning                                     | New account provisioning and a repeated run passed against real wiki/identity services                          |

The SSO test ran separately from the ephemeral demo suite against actual local services. It is skipped by default unless staging SSO variables are supplied. Persistence, socket, wiki, and S3 tests are also opt-in; see the prototype guide for their environment variables.

Remote staging deployment, public DNS, ACME certificates, HTTPS browser acceptance, and an operator backup/restore drill remain unverified because no hosting configuration was supplied. The local demo is intentionally ephemeral and does not substitute for the Wiki.js/Keycloak deployment.

## Z up coordinate update

The coordinate update passed 31 default domain/HTTP checks (including five new coordinate and migration regressions), the ten-identity socket check, and four browser flows including XYZ elevation editing and X/Y zone drawing. The workspace and container builds passed. The perspective view was visually checked with an elevated image card and upright glTF model. External wiki, PostgreSQL, S3, and SSO checks above describe the original prototype validation; they were not rerun for this coordinate-only update.

## Selection, control, inventory and interior update

The updated default suite passes 44 checks, including ten new live-Thing checks for control delegation/revocation, character ownership, private-content filtering, atomic/retried pickup, nested drop, stable item identity, independent session copies, inventory template isolation, state restoration, interior navigation and withdrawn parent access. Four external integration checks remain opt-in and were not rerun for this update.

Five browser flows passed, including two browsers selecting without movement, delegating a token, moving it with right-click, taking and dropping it, opening a character's contents, showing separate full artwork, and denying another character's private contents. Workspace/container builds passed. The optional real shared-login check remains skipped without SSO configuration.

The updated local preview is isolated at `http://127.0.0.1:3101` in container `wikitop-interactions-preview`, using image `wikitop-play:interactions`. It uses fresh ephemeral data. The existing demo on port 3100 is preserved. Use the preview URL as written so its hostname also separates its login cookies from the original localhost demo.

## Wiki and character editing update

The default suite still passes 44 checks. Six browser flows pass, with a new flow covering the local Wiki link, draft article saving, character name/description editing and the Background editor label. The build passes; external wiki/SSO and other opt-in integrations were not rerun. The preview server upgrade preserves its existing memory-store records and wiki pages through a private local checkpoint rather than reseeding IDs. This is a one-time local upgrade procedure, not ongoing database persistence.

## Separate location and viewed spaces

The default suite passes 55 checks, including ten new view-domain regressions and authenticated HTTP coverage for closed/hidden interior background assets. Eight browser flows pass, including a three-browser flow for main-viewport interiors, nested backpack privacy, item movement in both camera views, sharing/revocation, reconnect, character travel while inspecting yourself, and Return to character resolving the new room. A separate flow saves nested character template layouts and flags. The interior screenshot was visually inspected. Workspace and container builds pass. Optional real wiki, PostgreSQL, S3, socket-load and SSO checks were not rerun for this update.

The existing preview on `http://127.0.0.1:3101` is upgraded from a private checkpoint containing world records, wiki pages and uploaded image bytes. Existing record IDs and publication hashes are retained; legacy inventory privacy/layout normalization runs on session copies. The older port 3100 demo remains separate. The checkpoint is a local upgrade restore point, not ongoing persistence; PostgreSQL/S3 remain the persistent deployment path.

### Library tabs and content tags

Validated the build, 57 domain/HTTP checks, and 9 browser flows (4 optional service integrations and the hosted SSO browser flow remain skipped without their services). Added coverage for owned/shared tab separation, article tag editing/filtering, tag normalization and limits, unauthorized tag edits, character/nested Thing tags, legacy scene compatibility, and immutable publication metadata. Updated existing browser flows to navigate the new tabs. Preview upgrades use a private checkpoint and preserve current records.

### Published article exit catalogs

The build and 61 domain/HTTP checks pass. Coverage includes generated exit links, direct-request authorization, local wiki rendering, pinned prose, unchanged placement and session pins while browsing, disabled and stale connections, inaccessible destination redaction, and unexplored doors. All 10 browser flows pass (the new article flow was rerun after correcting an ambiguous heading selector). Browser coverage adds destination browsing in standalone and session article views, with Travel remaining a separate live action. Four optional service integrations and hosted SSO still require their external services.

The local memory wiki renders the generated catalog below its prose editor. External Wiki.js content is not rewritten; WikiTop’s published article reader supplies the catalog for that deployment mode.

### Unexplored-exit authoring and contribution grants

Added domain coverage for owner-created draft destinations, unchanged publications/session pins, duplicate creation denial, permission requests and approval, independent destination ownership, explicit connection acceptance, single-claim invitation links, revocation, door scoping, stale grants, and login return-path validation. The default suite passes 66 checks, with four optional external integrations skipped. Browser coverage exercises the owner, requester, approver, and link-recipient workflows plus creation immediately after saving a new editor door. All 12 browser flows pass across the full regression run and targeted reruns after the invitation-field label and saved-door fixes. Existing navigation, live play, interiors, and article browsing flows remain covered. Shared hosted SSO still requires its configured external services.

### Unified Thing authoring documents and workspace

Validated the build/typechecks and 76 domain/HTTP checks, with four optional external-service integrations skipped. All 16 browser flows pass across the full regression run and targeted final reruns; hosted SSO remains skipped without its configured services. New coverage exercises normalized document round trips, stable IDs/reparenting, identity reservation, retained publication and session records, revision conflicts and retry deduplication, private published projections, independent token/model/artwork/background references, GLB upload/authorization, browser offline recovery, preserved conflict copies, character-card creation and nested full-viewport navigation. Existing scene layout, connection invitations, public article links, private play, movement, travel, and interior permissions remain covered with the new authoring controls.

The new workspace is an authoring refactor. It does not add Git persistence, individual child wiki articles, portable Thing metadata exports, collaborative drawing, or live session editing. External art remains a mutable hotlink; GLB support intentionally targets self-contained static core models.

The old local preview was already stopped when this upgrade began. Restore from the newest available private checkpoint and compare preserved area, character, publication/hash, session, placement, message, connection, invitation, wiki-page, and media records before accepting the upgrade. New `thingIds` metadata starts empty and is populated by authorized authoring saves. The local preview now maintains its own atomic checkpoints, including media bytes, at five-second intervals and on graceful shutdown; production remains PostgreSQL/S3 backed.

The restored preview was smoke-tested in both area and character workspaces, through the document view and character-card session entry. Its saved records and media were compared across a graceful container replacement/restart with no content or placement changes. The final autosave browser check also verifies automatic retry after a temporary server outage using a single operation ID.

## Live shared drawing — October 21, 2026

The default suite passes 88 domain/HTTP checks, including 12 drawing regressions for concurrent strokes, retry deduplication, personal undo/redo, erase ownership, board isolation, private-space revocation, draft/publication isolation, stale saves, restart recovery, wiki outages, nested template identities, transferred-container collisions, independently edited authored ink, and live edits during a slow wiki save. Four external-service integrations remain opt-in and were not rerun.

All 17 configured local browser flows pass; hosted shared-login remains skipped without its services. The new two-browser drawing flow verifies named live cursors, ink across 2D and 3D, personal undo/redo, owner-only draft saving, unchanged publications/placements, and reload recovery. The named-cursor assertion was also rerun against the final source-identity safeguard. Workspace typechecks and the Docker build pass. A drawing screenshot was visually inspected for floor alignment and toolbar usability.

The existing preview at `http://127.0.0.1:3101` now uses `wikitop-play:shared-drawing`. Its previous container is retained as `wikitop-interactions-preview-before-drawing`. Graceful shutdown captured `.data/preview-before-shared-drawing.json` privately before restoration. The upgrade preserves the current two areas, five characters, one session, two placements, two publications and five assets, with unchanged authored/live records, wiki pages and uploaded bytes. Automated five-second checkpoints continue. A read-only smoke check verified the live drawing toolbar, both cameras, interior navigation and the existing character location. No production/HTTPS deployment or ten-artist load benchmark was performed.

## Current-character checkboxes — October 22, 2026

Character cards now support independent current-character checkboxes in Characters and Sessions, remembered per account in browser storage. Session entry admits the selected group atomically and retains a single viewing anchor. Typechecks, container build, and 89 default domain/HTTP checks pass; the new domain regression covers ownership rejection without partial joins and idempotent rejoining. The new browser flow verifies multiple checked characters, reload persistence and both characters appearing in play. Existing single-character browser scenarios explicitly clear other current selections before joining.

The local preview uses `wikitop-play:current-characters`. A private checkpoint at `.data/preview-before-current-characters.json` and the stopped `wikitop-interactions-preview-before-current-characters` container preserve the prior version. A browser smoke check verified multiple selections and reload persistence without joining or moving any existing character. Authoring/live records, wiki pages and uploaded bytes were compared with the checkpoint and remain unchanged.

The complete updated local browser regression suite passes all 18 scenarios; hosted SSO remains skipped without its external configuration.

## Extended drawing canvas — October 22, 2026

The drawing canvas now spans 20 km on each axis independently of map dimensions and background assets. Vector stroke geometry replaces the fixed-size raster drawing texture. Workspace/container builds and 90 domain/HTTP checks pass; four optional service checks remain skipped. All 19 local browser scenarios pass, with hosted SSO skipped. New coverage verifies drawing in a blank space, strokes beyond the map rectangle, panning over 100 meters before drawing, saving distant ink, unchanged space dimensions/placements, shared coordinate validation and SVG view boxes containing off-map ink. A domain case saves strokes near (9000, -8000). The blank-canvas screenshot was visually inspected.

The local preview uses `wikitop-play:extended-drawing`, restored from `.data/preview-before-extended-drawing.json`. The prior container is retained as `wikitop-interactions-preview-before-extended-drawing`. Its first replacement encountered a port-release race and was recreated with fresh Docker networking; the final browser smoke check passes in both camera modes. Existing content, drawing boards, uploads, IDs, wiki pages, publication hashes and physical placements remain unchanged.

## Compact live header — October 22, 2026

The active character's name now returns the view to their location from the main header, with a neighboring swap control opening owned character cards. The live subheader contains only view breadcrumbs. Removed session/status headings, duplicated interior/location text, Back, the zone badge, the separate Return control and Leave session. Physical Leave interior remains in the sidebar. Swapping changes the joined viewing character without removing other placements.

Typechecks and container build pass. All 20 local browser scenarios pass; hosted SSO remains skipped. The new flow verifies the named header control, interior-to-room return, removed controls, character-card swapping, canceling and preserved physical placement. Existing navigation scenarios use breadcrumbs and authorized snapshots to check physical location. The preview uses `wikitop-play:compact-header`, with private backup `.data/preview-before-compact-header.json` and rollback container `wikitop-interactions-preview-before-compact-header`. Its smoke check and visual inspection pass; existing authored/live records, wiki pages, uploaded bytes and drawing boards remain unchanged.
