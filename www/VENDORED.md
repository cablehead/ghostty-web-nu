# Vendored runtime assets

These three files are checked into the repo so a fresh clone (or a
container copy) can serve the UI without an `npm install`:

    ghostty-web.js                          ES module (Terminal, FitAddon, init)
    ghostty-vt.wasm                         the VT parser/renderer wasm blob
    __vite-browser-external-2447137e.js     tiny shim ghostty-web imports

## Provenance

They come from the `ghostty-web` npm package, built and shipped by Coder:

    package    ghostty-web
    upstream   https://github.com/coder/ghostty-web
    npm        https://www.npmjs.com/package/ghostty-web

The pinned version this directory currently mirrors is recorded in the
project's `package.json` (`dependencies.ghostty-web`).

## Customization policy

`ghostty-web.js` is **locally customized** -- we patch it in-tree when
upstream behavior doesn't fit our UX. The wasm blob and the vite shim
are still copied verbatim. See `docs/adr/0002` for the rationale.

Every customization gets an entry in the "Local patches" section below
so a refresh has a checklist to re-apply.

## Local patches

### Scrollbar gutter (added 2026-05-23)

Upstream renders the vertical scrollbar at `canvas.width - 12`, which
overlaps the rightmost 1-2 columns of text whenever the scrollbar is
visible. We widen the canvas by `SCROLLBAR_GUTTER` (15px) past
`cols * cellWidth` so the scrollbar lands in dedicated space and the
cells stay clear. Cell rendering uses `col * cellWidth` for x-coords,
so the extra width is unused background.

Touched:

- A new module-scope `const SCROLLBAR_GUTTER = 15;` next to the
  existing FitAddon constants (`gA = 15`, etc.).
- `Renderer.resize` -- adds `SCROLLBAR_GUTTER` to canvas width (style
  and pixel buffer) and to the initial `fillRect`.
- The size-mismatch check inside `Renderer.render` -- expects
  `(cols*cellWidth + SCROLLBAR_GUTTER) * dpr`.
- `Terminal.handleFontChange` and `Terminal.resize` direct canvas
  width sets -- include `SCROLLBAR_GUTTER`.

Search for `SCROLLBAR_GUTTER` in the file to find all sites.

## Refreshing

When you want to pull a newer ghostty-web release:

    # 1. Bump the version in package.json (or `npm install ghostty-web@<ver>`).
    npm install ghostty-web@<version>

    # 2. Copy the three dist files over the vendored copies.
    cd www
    cp ../node_modules/ghostty-web/dist/ghostty-web.js .
    cp ../node_modules/ghostty-web/dist/ghostty-vt.wasm .
    cp ../node_modules/ghostty-web/dist/__vite-browser-external-2447137e.js .

    # 3. Re-apply each entry in "Local patches" above. Grep upstream for
    #    the named anchors (e.g. `canvas.style.width`, `renderScrollbar`)
    #    in case line numbers drifted; the patch sites are usually only
    #    a few lines each.

    # 4. Commit the new version, the re-applied patches, and the
    #    updated package.json/lock together.

If upstream adds or renames dist files, update the list at the top
and the script. The current set matches the imports in `sessions.html`
-- check there if something stops loading.
