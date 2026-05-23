# ADR 0002: Customize the Vendored ghostty-web.js

## Context

`www/ghostty-web.js` is the compiled ES module from the `ghostty-web`
npm package. Until now, the rule recorded in `www/VENDORED.md` was:
"copied verbatim from `node_modules/ghostty-web/dist/` after install --
they are NOT modified." Refreshes were a `cp` over the file.

That rule made sense while we were treating ghostty-web as a black-box
runtime dependency. Two pressures pushed against it:

- **UX gaps that need surgical fixes.** The vertical scrollbar overlaps
  the rightmost text columns because it's painted onto the same canvas
  the cells render to. There is no DOM, CSS, or public-API knob that
  moves it. The only ways to fix it from outside the file are either
  (a) suppress the scrollbar entirely and re-implement it in our DOM
  (~40-60 lines of JS, plus a parallel implementation that has to track
  upstream's scroll model), or (b) a runtime monkey-patch on the
  renderer instance that fights the upstream resize loop.
- **The cost of customization is small and localized.** The actual
  patch sites for the scrollbar gutter are five short edits, named
  clearly enough that re-applying them against a future upstream
  version is a grep-and-edit, not a merge conflict.

## Decision

`www/ghostty-web.js` is **locally customized**. We patch it in-tree
whenever the upstream behavior doesn't match our UX, and we treat
each customization as a first-class change with the same review and
documentation expectations as any other code.

The wasm blob and the vite shim stay verbatim -- they're opaque
artifacts where in-tree edits don't pay back.

`www/VENDORED.md` keeps:

- The provenance section (where the file comes from and which version
  we mirror).
- A "Local patches" section -- one short entry per customization,
  naming the touched anchors so a refresh has a checklist.
- An updated refresh procedure: copy upstream over the file, then walk
  the patch list and re-apply each one. Patches use named constants
  (`SCROLLBAR_GUTTER`, etc.) that grep cleanly even after upstream
  minification shifts line numbers.

## Consequences

- **Each ghostty-web upgrade has manual work.** Re-applying patches is
  the cost of the policy. Mitigation: patches are small, named, and
  documented. The first customization (scrollbar gutter) is ~5 lines
  across the file.
- **We can fix UX issues directly instead of working around them.**
  The scrollbar gutter is the motivating example; future cases (e.g.
  custom cursor styles, mouse-event hooks) are unblocked by the same
  policy.
- **Drift risk if patches aren't re-applied.** A refresh that skips the
  patch list silently regresses the UX. Mitigation: VENDORED.md's
  refresh procedure makes re-applying step 3, and each patch entry
  names the symptom it fixes so a refresher knows what to test.
- **We don't fork the package.** The on-disk file is still the upstream
  build plus small named edits. No build pipeline, no source-level
  fork, no package.json rewrite. If the diff ever grows to where
  re-applying is painful, that's the signal to revisit (fork properly,
  or upstream the changes).
