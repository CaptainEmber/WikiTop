# WikiTop

WikiTop is a static browser and editor for shared worlds made of **Things**. A Thing has a face—the token, card, or model shown elsewhere—and a page containing prose, a canvas, drawings, and placed links to other Things. Every published Thing is one self-contained GLB file.

This repository is both the application and a starter world. GitHub Pages publishes the browser, Git stores the world, forks and branches hold proposed edits, and pull requests are how worlds grow together. The browser keeps working drafts in IndexedDB and exports GLBs; it never asks for a GitHub token.

## Run locally

Requires Node.js 22 and pnpm 10.6.5.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm validate
pnpm dev
```

Build with `pnpm build` and preview with `pnpm preview`.

## Contribute a Thing

1. Fork and clone the template.
2. Browse or create a Thing in WikiTop.
3. Export its GLB into `world/` using a readable filename.
4. Run `pnpm validate && pnpm test && pnpm build`.
5. Commit the GLB and open a pull request.

See [the prototype guide](docs/PROTOTYPE.md), [format reference](docs/FORMAT.md), and [contribution guide](CONTRIBUTING.md). Code uses the [MIT License](LICENSE); designated starter content uses [CC0 1.0](CONTENT-LICENSE).
