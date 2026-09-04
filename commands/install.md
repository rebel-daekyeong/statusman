---
description: Install the statusman two-line statusline into Claude Code settings
allowed-tools: Bash(node:*), Read
---

Install statusman as the Claude Code statusline.

1. Run `node ${CLAUDE_PLUGIN_ROOT}/install.js`.
2. Report the path it wrote to and the backup path it printed.
3. If it printed a `replacing statusLine:` line, show that previous value to the
   user so they can decide whether they want it back.
4. Tell the user the new statusline appears on the next render (a few seconds),
   and that restoring the backup undoes the change.
