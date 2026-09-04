// Shared fixtures. The statusline is deterministic given its inputs, so every
// test pins the clock and the terminal width rather than reading either.

"use strict";

const { mkdtempSync, rmSync } = require("fs");
const { join } = require("path");
const { tmpdir } = require("os");

/** A fixed instant every fixture's reset stamps are measured against. */
const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);

/** Columns a 119-column terminal leaves the statusline. */
const COLUMNS = 113;

const strip = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");

/** Bar cells at the head of one rendered gauge, or 0 when it drew no bar. */
const barCells = (cell) => cell.match(/^[█░|]*/)[0].length;

/**
 * A full set of sources: the statusline JSON Claude Code puts on stdin, the
 * account block from ~/.claude.json, and a cached /api/oauth/usage snapshot.
 * `overrides` is merged one level deep, so a test can replace `stdin` whole.
 */
function sources(overrides = {}) {
  return {
    stdin: {
      model: { id: "claude-opus-5", display_name: "Opus 5" },
      effort: { level: "xhigh" },
      session_name: "statusman",
      workspace: { current_dir: "/Users/x/src/statusman" },
      context_window: { used_percentage: 13, total_input_tokens: 26000, context_window_size: 200000 },
      rate_limits: {
        five_hour: { used_percentage: 30, resets_at: (NOW + 4 * 3600_000 + 25 * 60_000) / 1000 },
        seven_day: { used_percentage: 55, resets_at: (NOW + 2 * 86400_000 + 14 * 3600_000) / 1000 },
      },
    },
    config: {
      oauthAccount: {
        organizationName: "Rebellions-Lime",
        emailAddress: "daekyeong.kim@rebellions.ai",
        hasExtraUsageEnabled: false,
      },
    },
    cache: {
      utilization: {
        extra_usage: { is_enabled: false, utilization: null },
        limits: [
          { kind: "weekly_all", percent: 55, is_active: true, scope: null },
          {
            kind: "weekly_scoped",
            percent: 54,
            is_active: false,
            resets_at: "2026-09-07T02:00:00.000Z",
            scope: { model: { display_name: "Fable" } },
          },
        ],
      },
    },
    ...overrides,
  };
}

/** Run `body` with $STATUSMAN_CONFIG pointing at a settings file of its own. */
function withSettingsFile(body) {
  const dir = mkdtempSync(join(tmpdir(), "statusman-test-"));
  const path = join(dir, "settings.json");
  const previous = process.env.STATUSMAN_CONFIG;
  process.env.STATUSMAN_CONFIG = path;
  try {
    return body(path);
  } finally {
    if (previous === undefined) delete process.env.STATUSMAN_CONFIG;
    else process.env.STATUSMAN_CONFIG = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { COLUMNS, NOW, barCells, sources, strip, withSettingsFile };
