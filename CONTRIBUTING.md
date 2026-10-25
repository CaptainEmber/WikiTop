# Contributing

World changes are pull requests. Keep changes focused because Git cannot merge concurrent binary edits to the same GLB.

- Put canonical files under `world/` and keep each Thing below 25 MiB.
- Keep IDs stable and never reuse an existing ID for a different Thing.
- Embed media before export. Do not add secrets, private session data, databases, or unlicensed media.
- Run `pnpm validate`, `pnpm test`, and `pnpm build`.
- Review the semantic diff artifact for placements, links, drawings, and media.

Starter content contributed under `world/` is released under CC0 unless an accepted, more specific license accompanies it.
