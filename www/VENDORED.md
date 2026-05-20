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
project's `package.json` (`dependencies.ghostty-web`). The files here are
copied verbatim from `node_modules/ghostty-web/dist/` after install --
they are NOT modified.

## Refreshing

When you want to pull a newer ghostty-web release:

    # 1. Bump the version in package.json (or `npm install ghostty-web@<ver>`).
    npm install ghostty-web@<version>

    # 2. Copy the three dist files over the vendored copies.
    cd www
    cp ../node_modules/ghostty-web/dist/ghostty-web.js .
    cp ../node_modules/ghostty-web/dist/ghostty-vt.wasm .
    cp ../node_modules/ghostty-web/dist/__vite-browser-external-2447137e.js .

    # 3. Commit the new versions and the updated package.json/lock together.

If upstream adds or renames dist files, update this list and the script.
The current set matches the imports in `sessions.html` -- check there if
something stops loading.
