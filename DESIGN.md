# WikiTop design

WikiTop is a public, forkable way to build connected TTRPG worlds from reusable **Things**. It runs as a static GitHub Pages application. A Git repository is the published world database, branches and forks are drafts, and pull requests are publication and review.

The project supplies spatial presentation and portable authorship without defining game rules. People may represent HP, abilities, lore, or equipment through prose, tags, drawings, and Things.

## One idea: face and page

Every Thing follows the same rule, whether it is a character, sword, backpack, tavern, city, or region.

- Its **face** is how it appears when placed on another Thing: a token, card, labeled marker, or 3D model.
- Its **page** is what opens when followed: prose, a navigable XY canvas, drawings, zones, anchors, and placements of other Things.

A backpack placed on a character page is a visible link to the backpack Thing. Opening it shows the backpack page and its placed contents. A tavern placed on a city works the same way. There is no special inside/outside data model and no distinct area or character editor.

A placement has a stable ID, target Thing ID, local XYZ position, rotation, scale, and optional face override. Coordinates use meters with Z up. The top-down view shows X and Y; the perspective view uses the same scene and transforms.

## Files and published worlds

Each canonical Thing is an independent GLB file containing one normalized Thing document and its embedded media. The GLB remains a conventional glTF asset with a visible preview scene. WikiTop metadata lives in `asset.extras.WikiTop`; PNG, JPEG, WebP, and source-model bytes live in buffer views rather than base64 JSON.

Stable Thing IDs provide identity. Repository paths organize files but can change. A deterministic catalog maps IDs to paths, searchable metadata, hashes, sizes, and outgoing links. Links resolve inside the current repository. Missing targets remain visible and offer to create a draft with the requested ID.

A published Thing is read-only in the browser. Editing creates an IndexedDB draft. Export produces the GLB that a contributor commits to a fork or branch. Pull requests provide review, and GitHub Actions validate files and show semantic changes hidden inside binary diffs.

## Unified viewer and editor

The same full viewport browses and edits Things. View mode provides 2D and 3D cameras, article prose, a link list, breadcrumbs, and selection details. Edit mode adds placement movement, metadata and media controls, drawing, zones, anchors, and export.

Left click selects. Opening a selected placement follows its target without changing the source Thing. Back follows browser navigation history. Image-only Things use cards or tokens in both camera modes; Things without media use labeled markers. Drawings occupy the local XY plane independently of the page background and can extend far beyond its nominal dimensions.

Tags such as `character`, `setting`, `item`, and `vehicle` support discovery. A small `kind` field supplies useful catalog presentation but does not impose behavior or game mechanics.

## Collaboration

The initial collaboration model uses Git:

1. Browse the published GitHub Pages world.
2. Create or edit a local Thing draft.
3. Export one or more GLBs.
4. Commit them to a fork or branch.
5. Open a pull request and inspect its semantic report.
6. Merge to publish a new Pages build.

Keeping one Thing per file reduces binary conflicts and lets contributors work in separate parts of a world. Git cannot merge concurrent edits to the same GLB, so changes should remain focused. Future collaboration may add browser-created branches, direct GitHub writes, simultaneous drawing, presence, parties, and chat without changing the portable Thing contract.

## Technology

- TypeScript, React, and Vite for the static application.
- Three.js, React Three Fiber, and Drei for the shared 2D/3D scene.
- Zod for format and boundary validation.
- IndexedDB for private browser drafts and media.
- GitHub Pages for hosting and GitHub Actions for validation, catalog generation, semantic diffs, and deployment.
- Vitest and Playwright for format, migration, build-path, and browser workflows.

There is no production application server, account database, authentication service, or object store. The app never receives a GitHub credential in the first release.

## Safety and limits

Imports validate GLB structure, schema versions, stable identities, buffer ranges, media signatures and hashes, transforms, complexity, and size before replacing a draft. Export requires every media reference to be embedded. One Thing is limited to 25 MiB and one editor media file to 10 MiB. The starter world should remain below 250 MiB.

Portable files never include ownership, credentials, permissions, private sessions, chat, or character locations. Repository permissions determine who may merge published changes. Existing v1 nested WikiTop files migrate by splitting their tree into separate Thing drafts and replacing containment with placements.
