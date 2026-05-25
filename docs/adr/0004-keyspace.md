# ADR 0004: Keyspace

## Context

The sessions surface keeps growing keyboard chords (new/close/cycle/rename,
focus/escape, and now pane sizing). We need one place that says which chords
are taken, how they're scoped, and what makes a chord safe to add -- so new
bindings don't collide with each other, with the terminal, or with the
browser.

Two hard constraints shape the space:

- **The terminal owns most keys in focus mode.** When a pane is focused,
  key-buffer forwards almost everything to the pty, including plain `Esc`
  (TUIs need it) and `Ctrl`-letters. So app chords can't live on bare keys
  or `Ctrl` combos without stealing them from programs.
- **Browsers and the OS reserve `Cmd`/`Ctrl` widely** (Cmd+T new tab, Cmd+W
  close, Ctrl+L address bar, ...). Intercepting those fights the browser and
  surprises users.

## Decision

App chords use **`Alt`** (Option on macOS) and are **scoped to navigate
mode**. The capture-phase keymap handler only consults the keymap in navigate
mode; in focus mode it honors a single escape chord and lets everything else
reach the pty.

- **`Alt` is the app modifier.** It's largely free of browser/OS reservation,
  and it's the one modifier the terminal layer can cleanly cede in navigate
  mode. `Cmd`/`Ctrl` are left to the browser/OS and to TUIs.
- **`Alt+Esc` is the focus->navigate escape.** Plain `Esc` goes to the pty;
  `Alt+Esc` is the one chord honored in focus mode.
- **macOS Option produces glyphs** (Option+O -> "o-slash"). `comboKey`
  normalizes via `e.code` (`KeyO` -> `o`) and the handlers `preventDefault`,
  so detection is consistent across Chrome/Firefox/Safari and nothing gets
  typed. Any new `Alt+letter` chord inherits this for free.
- **Safety bar for a new chord:** must not be a default browser accelerator
  in Chrome/Firefox/Safari, must be detectable via `e.code` under Option, and
  must be a navigate-mode action (not something you'd want mid-terminal).
  `Alt+letter` combos clear this; bare `Alt` taps (Firefox/Windows menu bar)
  do not.

### Current chords

Navigate mode:

| Chord         | Action                         |
| ------------- | ------------------------------ |
| `Alt+T`       | New session                    |
| `Alt+D`       | Close current session          |
| `Alt+J`/`Alt+K` | Next / previous session      |
| `Alt+R`       | Rename current tab             |
| `Alt+Shift+R` | Rename window title            |
| `Alt+O`       | Cycle current pane width       |
| `Enter`       | Focus the selected pane        |

Focus mode:

| Chord     | Action                         |
| --------- | ------------------------------ |
| `Alt+Esc` | Back to navigate mode          |
| (all else)| forwarded to the focused pty   |

The status bar lists the active mode's chords and they are clickable, so the
keyspace is also discoverable without this document.

## Consequences

- **New bindings have a recipe:** an unused `Alt+letter`, registered in the
  navigate keymap + `window.app` action + status-bar binding. Three edits,
  one row in the table above.
- **We never compete with the browser or with TUIs**, at the cost of every
  app chord needing the `Alt` prefix (no single-key navigate actions today;
  if we want vim-style bare `j`/`k` in navigate mode later, that's a new
  decision -- navigate mode has key-buffer off, so it's available, but it
  would diverge from the `Alt`-prefixed set).
- **The table can drift** from the code. Mitigation: the status bar is
  generated from the same actions, so the live UI is the source of truth;
  this table is the rationale + reservation list.
