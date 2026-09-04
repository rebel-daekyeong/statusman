// The script as Claude Code and the shell actually run it.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const { terminalColumns, textWidth } = require("../statusline.js");

const SCRIPT = join(__dirname, "..", "statusline.js");
const strip = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");

const STDIN = JSON.stringify({
  model: { display_name: "Opus 5" },
  effort: { level: "xhigh" },
  session_name: "statusman",
  workspace: { current_dir: "/Users/x/src/statusman" },
  context_window: { used_percentage: 13, total_input_tokens: 26000, context_window_size: 200000 },
  rate_limits: {
    five_hour: { used_percentage: 30, resets_at: Math.floor(Date.now() / 1000) + 3600 },
    seven_day: { used_percentage: 55, resets_at: Math.floor(Date.now() / 1000) + 86400 },
  },
});

/**
 * A home directory of its own for every run: the script reads the signed-in
 * account from ~/.claude.json and its own settings from the config dir, so a
 * test that used the real ones would depend on the machine it runs on.
 */
function sandbox() {
  const home = mkdtempSync(join(tmpdir(), "statusman-cli-"));
  mkdirSync(join(home, ".claude", "statusman"), { recursive: true });
  writeFileSync(join(home, ".claude.json"), JSON.stringify({
    oauthAccount: { organizationName: "Rebellions-Lime", emailAddress: "daekyeong.kim@rebellions.ai" },
  }));
  writeFileSync(join(home, ".claude", "statusman", "usage-cache.json"), JSON.stringify({
    utilization: {
      limits: [{ kind: "weekly_scoped", percent: 54, is_active: true, scope: { model: { display_name: "Fable" } } }],
    },
  }));
  return home;
}

/** Run the script in `home` with `args`, feeding it `input` on stdin. */
function run(home, args = [], input = "") {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    input,
    encoding: "utf-8",
    env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), COLUMNS: "119" },
  });
  return { ...result, lines: strip(result.stdout).trimEnd().split("\n").filter(Boolean) };
}

function withSandbox(body) {
  const home = sandbox();
  try {
    return body(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("the statusline renders from the JSON on stdin", () => {
  withSandbox((home) => {
    const { status, lines } = run(home, [], STDIN);
    assert.equal(status, 0);
    assert.equal(lines.length, 2);
    assert.equal(lines[0], "Rebellions-Lime | daekyeong.kim | Opus 5 | xhigh | statusman | /Users/x/src/statusman");
    assert.match(lines[1], / 13% 26k \| /);
    assert.match(lines[1], / 54% Fable$/);
  });
});

test("no line ever ends in whitespace or overruns the terminal", () => {
  withSandbox((home) => {
    for (const columns of ["119", "80", "40"]) {
      const result = spawnSync(process.execPath, [SCRIPT], {
        input: STDIN,
        encoding: "utf-8",
        env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), COLUMNS: columns },
      });
      // The budget is the terminal less the indent Claude Code keeps, and a
      // wide character costs two columns of it — hence textWidth, not .length.
      const budget = terminalColumns({ COLUMNS: columns });
      for (const line of strip(result.stdout).split("\n").filter(Boolean)) {
        assert.equal(line, line.trimEnd(), `trailing space at ${columns}: ${JSON.stringify(line)}`);
        assert.ok(textWidth(line) <= budget, `${textWidth(line)} of ${budget} at ${columns}: ${line}`);
      }
    }
  });
});

test("without stdin only the components that need none are drawn", () => {
  withSandbox((home) => {
    const { status, lines } = run(home);
    assert.equal(status, 0);
    assert.equal(lines[0], "Rebellions-Lime | daekyeong.kim");
  });
});

test("--list reports the layout and every component", () => {
  withSandbox((home) => {
    const { status, stdout } = run(home, ["--list"], STDIN);
    assert.equal(status, 0);
    assert.match(stdout, /^2-line layout, components \(/);
    assert.match(stdout, /\n {2}org {6}on {3}line 1 {2}Rebellions-Lime\n/);
    assert.match(stdout, /\n {2}scoped {3}on {3}line 2 {2}54% Fable\n/);
  });
});

test("--list says so when the components that need stdin have none", () => {
  withSandbox((home) => {
    assert.match(run(home, ["--list"]).stdout, /no statusline JSON on stdin/);
    assert.doesNotMatch(run(home, ["--list"], STDIN).stdout, /no statusline JSON on stdin/);
  });
});

test("--off and --on survive into the next render", () => {
  withSandbox((home) => {
    assert.equal(run(home, ["--off", "cwd", "scoped"]).status, 0);
    const off = run(home, [], STDIN).lines;
    assert.ok(off[0].endsWith("| statusman"));
    assert.doesNotMatch(off[1], /Fable/);

    assert.equal(run(home, ["--on", "cwd"]).status, 0);
    assert.ok(run(home, [], STDIN).lines[0].endsWith("| /Users/x/src/statusman"));
  });
});

test("--lines 4 lays the statusline out in four", () => {
  withSandbox((home) => {
    const { status, stdout } = run(home, ["--lines", "4"]);
    assert.equal(status, 0);
    assert.match(stdout, /^4-line layout/);
    assert.equal(run(home, [], STDIN).lines.length, 4);
    assert.match(run(home, ["--list"]).stdout, /^4-line layout/);

    run(home, ["--lines", "2"]);
    assert.equal(run(home, [], STDIN).lines.length, 2);
  });
});

test("a flag it cannot honour fails loudly", () => {
  withSandbox((home) => {
    for (const args of [["--lines", "3"], ["--lines"], ["--off"], ["--off", "nope"], ["--nope"]]) {
      const result = run(home, args);
      assert.equal(result.status, 1, args.join(" "));
      assert.match(result.stderr, /statusman — components:/, args.join(" "));
      assert.equal(result.stdout, "", args.join(" "));
    }
  });
});

test("--help explains itself and exits clean", () => {
  withSandbox((home) => {
    const { status, stdout } = run(home, ["--help"]);
    assert.equal(status, 0);
    assert.match(stdout, /--lines <2\|4>/);
  });
});

test("junk on stdin is ignored rather than fatal", () => {
  withSandbox((home) => {
    const { status, lines } = run(home, [], "not json at all");
    assert.equal(status, 0);
    assert.equal(lines[0], "Rebellions-Lime | daekyeong.kim");
  });
});
