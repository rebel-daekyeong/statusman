// install.js, which rewrites a settings file the user cannot get back.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const INSTALL = join(__dirname, "..", "install.js");

const read = (path) => JSON.parse(readFileSync(path, "utf-8"));
const install = (settings, config) =>
  spawnSync(process.execPath, [INSTALL, "--settings", settings], {
    encoding: "utf-8",
    // Its own config dir: the backup goes under statusman's directory inside
    // this one, and a test must not write into the real ~/.claude.
    env: { ...process.env, CLAUDE_CONFIG_DIR: config },
  });

test("a second install leaves the first backup alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "statusman-install-"));
  try {
    const path = join(dir, "settings.json");
    const backup = join(dir, "statusman", "claude-settings.bak.json");
    writeFileSync(path, JSON.stringify({ statusLine: { type: "command", command: "my-own-statusline" } }));

    assert.equal(install(path, dir).status, 0);
    assert.equal(read(path).statusLine.command.endsWith("statusline.js"), true);
    // Written into a directory the installer had to create for it.
    assert.equal(read(backup).statusLine.command, "my-own-statusline");

    // Backing statusman's own config up over the original would leave nothing
    // to restore, which is the one thing the backup exists for.
    const second = install(path, dir);
    assert.equal(second.status, 0);
    assert.match(second.stdout, /backup kept from an earlier run/);
    assert.equal(read(backup).statusLine.command, "my-own-statusline");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("with no settings file there is nothing to back up", () => {
  const dir = mkdtempSync(join(tmpdir(), "statusman-install-"));
  try {
    const path = join(dir, "settings.json");
    const result = install(path, dir);
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /backup/);
    assert.equal(read(path).statusLine.padding, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
