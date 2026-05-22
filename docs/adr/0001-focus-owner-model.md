# ADR 0001: Focus Owner Model

## Context

The sessions UI has one primary interaction surface (the terminal) and a
handful of secondary ones (sidebar tab/close/copy/new buttons, topbar title,
rename modal). Every time the user touches a secondary surface, focus would
land there and not return -- visible as the `.term-wrap:focus-within` rule
dimming the terminal pane until the user clicked back into it.

We kept fixing this case by case:

- A `click` listener on `#sessions-list button` that called `term.focus()`
  after sidebar interactions.
- A `blur` listener on `.modal-input` that called `term.focus()` after the
  rename modal closed.
- An Enter-key handler in the global keydown that redirected focus into
  the terminal when activeElement was outside it.

Three patches enforcing the same invariant in three different ways, each
discovered after a user-reported regression. Any new UI element with focus
behavior would need a fourth patch.

## Decision

Single focus policy with an explicit *rightful owner*. One function names
who should hold focus right now; one function drives toward that state;
two listeners trigger enforcement after any focus change settles.

```js
function focusOwner() {
  if (modalInput && modalInput.offsetParent !== null) return 'modal';
  return 'terminal';
}

function enforceFocus() {
  const a = document.activeElement;
  switch (focusOwner()) {
    case 'modal':
      if (a !== modalInput) modalInput.focus();
      break;
    case 'terminal':
      if (!container.contains(a)) term.focus();
      break;
  }
}

document.addEventListener('focusin',  () => queueMicrotask(enforceFocus));
document.addEventListener('focusout', () => queueMicrotask(enforceFocus));
enforceFocus(); // initial: terminal grabs focus on page load
```

`focusOwner()` reads DOM state directly (`offsetParent !== null` for the
modal-input) rather than subscribing to a datastar signal, which keeps the
policy independent of the reactive framework.

`queueMicrotask` defers the decision to *after* the current user action's
in-flight focus shuffling has resolved, but before the next event or paint.
A click might fire mousedown -> button-focus, focusout, focusin, mouseup,
click, datastar-handler in one tick; running synchronously inside any of
those handlers would read mid-transition state. The microtask is also the
right tier to avoid re-entrancy: calling `term.focus()` from inside a
`focusin` listener would fire another `focusin` synchronously.

## Consequences

- **Two listeners replace three patches.** Sidebar clicks, modal closes,
  Alt-Tab returns, accidental programmatic focus shifts -- all funnel
  through the same correction.
- **Owner is declarative, not procedural.** New focus holders are added
  as cases in `focusOwner()` rather than as new event handlers scattered
  across the file.
- **Idempotent enforcement.** `enforceFocus()` no-ops when focus is
  already where it should be, so it's safe to call from anywhere
  (initialization, future explicit triggers).
- **Page-load focus is free.** Calling `enforceFocus()` once after the
  initial fit moves focus into the terminal without a separate code path.
- **`Enter`-outside-terminal redirect becomes dead code.** Removed: with
  the policy, activeElement is always either the terminal subtree or the
  modal input, so the redirect's predicate never matches.
- **Cost:** a new element that legitimately needs focus (e.g., a sidebar
  search input later) must be added to `focusOwner()`, or it will get
  rebounced. One place to know about, but a place that's easy to forget.
