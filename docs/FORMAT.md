# WikiTop Thing GLB format v2

A canonical file represents exactly one Thing. It is valid glTF 2.0 binary with a conventional preview scene and a manifest at `asset.extras.WikiTop`.

The manifest has `format: "wikitop-thing"`, `version: 2`, a normalized `document`, embedded-media records, and a root preview-node binding. The document gives the Thing a stable ID, metadata, a **face**, and a **page**.

The face is how the Thing appears when placed elsewhere. The page contains its prose canvas, drawing, zones, anchors, and placements. Each placement owns a local Z-up transform and points to another canonical Thing by stable ID. It may override the target's face.

Things may include a versioned, system-neutral `statBlock` containing labeled fields, trackable resources, and Markdown trait/action sections. A placement may set `hidden: true`; editors and live hosts see it translucently, while ordinary viewers do not render or list it. Hidden metadata remains readable to anyone who inspects the portable GLB and is not an authorization boundary.

A placement may set `partyExit: { anchorId? }`. This marks the existing link as a host-controlled travel route during live play; it does not create another link type. `anchorId` selects an anchor on the target Thing, and omission uses the target's first anchor. Placements without `partyExit` support personal navigation but cannot move the party.

If a placed Thing has no token or model face, WikiTop renders its name as a flat selectable map label. Repeated placements may reference the same target Thing and retain independent transforms. Live rooms can overlay independent position, resource, condition, and visibility state keyed by placement ID without changing the GLB.

PNG, JPEG, WebP, and source GLB media use GLB buffer views rather than base64. Records include MIME type, byte length, and SHA-256. Import validates signatures, hashes, ranges, complexity, identities, and size before replacing an open document. HTTPS references may exist while editing, but export requires embedded media.

Coordinates are meters on local XY with Z up. Conversion to glTF's Y-up basis happens at the file and renderer boundary. Catalog entries map stable IDs to repository paths and include lightweight arrival-anchor summaries; filenames do not establish identity. The catalog also records its repository, commit SHA, and raw base URL so a live room can pin published Things to the revision where play began.

Live room state is deliberately outside the GLB format. Participant positions, host roles, room drawings, credentials, and reconnect records are temporary overlays and are never imported into or exported from a Thing.
