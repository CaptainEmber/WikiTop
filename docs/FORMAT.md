# WikiTop Thing GLB format v2

A canonical file represents exactly one Thing. It is valid glTF 2.0 binary with a conventional preview scene and a manifest at `asset.extras.WikiTop`.

The manifest has `format: "wikitop-thing"`, `version: 2`, a normalized `document`, embedded-media records, and a root preview-node binding. The document gives the Thing a stable ID, metadata, a **face**, and a **page**.

The face is how the Thing appears when placed elsewhere. The page contains its prose canvas, drawing, zones, anchors, and placements. Each placement owns a local Z-up transform and points to another canonical Thing by stable ID. It may override the target's face.

PNG, JPEG, WebP, and source GLB media use GLB buffer views rather than base64. Records include MIME type, byte length, and SHA-256. Import validates signatures, hashes, ranges, complexity, identities, and size before replacing an open document. HTTPS references may exist while editing, but export requires embedded media.

Coordinates are meters on local XY with Z up. Conversion to glTF's Y-up basis happens at the file and renderer boundary. Catalog entries map stable IDs to repository paths; filenames do not establish identity. The catalog also records its repository, commit SHA, and raw base URL so a live room can pin published Things to the revision where play began.

Live room state is deliberately outside the GLB format. Participant positions, host roles, room drawings, credentials, and reconnect records are temporary overlays and are never imported into or exported from a Thing.
