## Git Commit Style Preferences

**Commit and push after each stable change** (tests pass / verified working) --
no need to wait to be asked. Do not commit half-finished or red-test states.

When committing: review `git diff`

- Use conventional commit format: `type: subject line`
- Keep subject line concise and descriptive
- **NEVER include marketing language, promotional text, or AI attribution**
- **NEVER add "Generated with Claude Code", "Co-Authored-By: Claude", or similar
  spam**
- Follow existing project patterns from git log
- Prefer just a subject and no body, unless the change is particularly complex

Example good commit messages from this project:

- `feat: 2-pane sessions UI; hard-debounced fit() to prevent drag freeze`
- `feat: route nu sessions through pty --embedded; add resize repro tests`
- `test: webkit engine support; resize: coalesce + ctrl+l band-aid`

## Tone and Communication

Prefer calm, matter-of-fact technical tone. ASCII only.

## Code Quality

Use ASCII characters only in code, comments, and documentation.
