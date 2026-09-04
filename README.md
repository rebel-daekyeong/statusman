# statusman

A two-line Claude Code statusline: who and what is answering on top, how much
budget is left below.

![Identity on the first line, four gauges on the second](preview.png)

Needs Node 18 or newer, and nothing else.

## Install

```
/plugin marketplace add rebel-daekyeong/statusman
/plugin install statusman@statusman
/statusman:install
```

`/statusman:install` writes `statusLine` into `~/.claude/settings.json`, after
copying the file to `~/.claude/statusman/claude-settings.bak.json`. To undo:

```
cp ~/.claude/statusman/claude-settings.bak.json ~/.claude/settings.json
```

Without the plugin marketplace, a clone does the same:

```
git clone https://github.com/rebel-daekyeong/statusman
node statusman/install.js
```

## What it shows

| id | shows |
|---|---|
| `org` | organization |
| `account` | account, the local part of the email |
| `model` | model display name |
| `effort` | effort level |
| `session` | session name, or the working directory's basename |
| `cwd` | working directory |
| `ctx` | context window, with the tokens used |
| `5h` | the 5-hour window, with its countdown |
| `week` | the weekly window, with its countdown |
| `scoped` | the model-scoped weekly cap, named by model |

Bars turn yellow at 60% and red at 85%. On the timed gauges a `|` marks how far
the window itself has run, so fill left of the tick means the budget is
outlasting the clock.

Components drop out when they have nothing to show, and adapt to the terminal
width on their own — the line is never truncated mid-render.

## Configure

```
/statusman list
/statusman off scoped cwd
/statusman on scoped
/statusman toggle org
/statusman lines 4
```

Four lines splits each row in half, so every component gets about twice the
columns:

```
Rebellions-Lychee | daekyeong.kim | Opus 5 | xhigh
README rewrite | /Users/daekyeong/src/statusman
█████████░░░░░░░░░░░░░░░░░░░░░░░░░░░ 24% 240k | █|██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 10% 4h49m
█████████████████████|░░░░░░░░░░░░░░ 61% 2d21h | ██████████████████░░░|░░░░░░░░░░░░░░ 50% Fable
```

Settings live in `~/.claude/statusman/`, alongside the usage cache and the
backup of Claude Code's settings.

## Network

Rendering reads no network. `scoped` — and `5h`/`week` when Claude Code does not
pass them in — come from a cached `/api/oauth/usage` snapshot, the same
undocumented endpoint `/usage` reads. Refreshing it runs in the background, and
sends nothing but the OAuth token Claude Code already stores, to
`api.anthropic.com`. With `scoped` off, no request is made at all.

## Developing

```
pnpm install                         # eslint, the only dependency, and dev-only
git config core.hooksPath .githooks  # lint and test on every commit
pnpm run check                       # eslint . && node --test test/*.test.js
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the coding convention and how to add
a component.

## License

MIT — see [LICENSE](LICENSE). Changes are listed in
[CHANGELOG.md](CHANGELOG.md).
