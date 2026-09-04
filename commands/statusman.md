---
description: Configure the statusman statusline — line count, and which components it draws
argument-hint: [list | lines 2|4 | on <id>... | off <id>... | toggle <id>...]
allowed-tools: Bash(node:*)
---

Configure the statusman statusline.

Arguments given: `$ARGUMENTS`

1. Turn the arguments into one flag for `node ${CLAUDE_PLUGIN_ROOT}/statusline.js`:
   `list` (or no arguments) becomes `--list`; `lines 4` becomes `--lines 4`;
   `on X Y` becomes `--on X Y`; likewise `off` and `toggle`. Anything else: run
   `--help` and show it.
2. Run that command with Bash.
3. Show the output as-is. After a change, add one line saying the statusline
   picks it up on its next render, a few seconds away.

`lines` takes 2 (the default: identity on one line, gauges on the next) or 4
(identity split over two lines, gauges over two more, so everything gets about
twice the columns).

Component ids are `org`, `account`, `model`, `effort`, `session`, `cwd` and
`ctx`, `5h`, `week`, `scoped`. If the user names something that is not an id,
run `--list` and let them pick from it.
