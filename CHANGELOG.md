# Changelog

## Unreleased

- Two-line statusline: organization, account, model, effort, session name and
  working directory on the first line; context window, the 5-hour window, the
  weekly window and the model-scoped weekly cap on the second.
- A selectable four-line layout, `/statusman lines 4`.
- Per-component width adaptation: text clips, the working directory rewrites
  itself from the front, gauge rows shed bars and then trailers.
- `/statusman` and the matching `statusline.js` flags to switch components on
  and off, stored in `~/.claude/statusman/settings.json`.
- `/statusman:install` to write the `statusLine` setting, keeping a backup.
- `refresh.js`, which fetches the usage snapshot the model-scoped weekly cap
  comes from. The statusline spawns it in the background when the snapshot goes
  stale and never waits for it.
