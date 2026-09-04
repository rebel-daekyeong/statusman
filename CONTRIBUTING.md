# Contributing

## Getting set up

```
pnpm install                       # eslint; nothing else, and nothing at runtime
git config core.hooksPath .githooks # lint and test on every commit
```

```
pnpm run lint     # eslint .
pnpm test         # node --test "test/*.test.js"
pnpm run check    # both
```

The statusline itself has no dependencies and must keep it that way: it runs on
every render, in whatever `node` the user's PATH turns up. `eslint` is a dev
dependency and nothing more.

## Coding convention

The linter holds the mechanical half — two-space indent, double quotes,
semicolons, trailing commas, `const` over `let` over `var`, `===`, 128 columns
(140 in tests), no unused or shadowed names. `pnpm run lint:fix` settles most of
it. What follows is the half it cannot check.

**Keep the render pure.** Everything above the `--- IO ---` divider in
`statusline.js` takes its inputs as arguments — the sources, the clock, the
terminal width, the settings. That is what lets the tests pin all four and
assert on exact output. New logic goes above the divider; new file or
environment reads go below it.

**Never throw on the render path.** A statusline that crashes leaves the user
with nothing and no error to read. Every read is best-effort and returns
`undefined` instead of raising; every field is checked before use
(`isRecord`, `typeof`), because the payloads are external and change between
Claude Code versions.

**A component that has nothing to say says nothing.** No placeholder, no `off`,
no empty gauge — it leaves the line and hands its columns to the rest. A row
left with nothing disappears rather than printing blank.

**Measure in columns, not characters.** Use `textWidth`; a Korean session name
is twice as wide as its length. A component that overruns its budget is a bug:
Claude Code truncates the line and eats whatever was last.

**Comment the why, never the what.** Say what the code cannot: the measurement
behind a constant, why a fallback exists, what the alternative broke. If a
comment restates the line below it, delete the comment.

**Explain a magic number where it is defined.** `RESERVED_COLUMNS` and
`MIN_BAR_CELLS` each carry the observation that set them. A number without one
is a number nobody can safely change.

## Tests

`test/` runs on `node:test`, no framework. One file per concern:

| file | covers |
|---|---|
| `text.test.js` | column measurement, clipping, path trimming |
| `format.test.js` | tokens, durations, reset stamps, the meter |
| `model.test.js` | `buildContext`: which source wins, and the fallbacks |
| `layout.test.js` | both layouts, and what gives way as the terminal narrows |
| `components.test.js` | the component list, and switching parts off |
| `settings.test.js` | `~/.claude/statusman/settings.json` and the flags that write it |
| `cli.test.js` | the script as it is actually run, in a sandboxed `$HOME` |

Shared fixtures live in `test/helpers.js`. Tests that touch settings go through
`withSettingsFile`; CLI tests go through `sandbox()`, which builds a throwaway
home directory — nothing in the suite may read the real `~/.claude.json` or
depend on the machine it runs on.

A change to how something renders comes with the exact expected string. If a
number in an assertion is not obvious, the comment says where it came from.

## Adding a component

1. Add an entry to `COMPONENTS` in `statusline.js`: an `id`, its row in each
   layout (`line: { 2: n, 4: n }`), a `kind`, a color for the text kinds, and a
   `pick` that reads the field off the context.
2. Have `buildContext` produce that field, `undefined` when the source is
   missing.
3. Extend `test/components.test.js` and `test/layout.test.js`.
4. Document the id in `README.md` and note the change in `CHANGELOG.md`.
