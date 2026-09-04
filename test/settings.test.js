// The on/off state and the line count, and the flags that change them.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const {
  COMPONENT_IDS, DEFAULT_LINES, applyFlag, readDisabled, readLines, settingsPath, writeDisabled, writeSettings,
} = require("../statusline.js");
const { withSettingsFile } = require("./helpers.js");

const read = (path) => JSON.parse(readFileSync(path, "utf-8"));

test("a missing settings file means everything is on, in two lines", () => {
  withSettingsFile((path) => {
    assert.equal(settingsPath(), path);
    assert.deepEqual([...readDisabled()], []);
    assert.equal(readLines(), DEFAULT_LINES);
  });
});

test("unreadable settings fall back rather than throw", () => {
  withSettingsFile((path) => {
    writeFileSync(path, "{ not json");
    assert.deepEqual([...readDisabled()], []);
    assert.equal(readLines(), DEFAULT_LINES);
  });
});

test("a bad line count in the file reads as the default", () => {
  withSettingsFile((path) => {
    for (const lines of [3, 0, "4", null]) {
      writeFileSync(path, JSON.stringify({ lines }));
      assert.equal(readLines(), DEFAULT_LINES, String(lines));
    }
    writeFileSync(path, JSON.stringify({ lines: 4 }));
    assert.equal(readLines(), 4);
  });
});

test("disabled ids are stored in the order the components are drawn", () => {
  withSettingsFile((path) => {
    writeDisabled(new Set(["scoped", "org", "5h"]));
    assert.deepEqual(read(path).disabled, ["org", "5h", "scoped"]);
    assert.deepEqual([...readDisabled()].sort(), ["5h", "org", "scoped"]);
  });
});

test("an id nobody recognises is kept, so a typo stays visible", () => {
  withSettingsFile((path) => {
    writeFileSync(path, JSON.stringify({ disabled: ["org", "nope", 7] }));
    // Non-strings are dropped; an unknown string is not.
    assert.deepEqual([...readDisabled()].sort(), ["nope", "org"]);
  });
});

test("an unknown id survives a write it had nothing to do with", () => {
  withSettingsFile((path) => {
    writeFileSync(path, JSON.stringify({ disabled: ["scoped", "scpoed"] }));
    applyFlag("--off", ["cwd"], readDisabled());
    // Dropping it would erase the typo --list is there to surface.
    assert.deepEqual(read(path).disabled, ["cwd", "scoped", "scpoed"]);
  });
});

test("the directory the settings live in is created on the way", () => {
  const dir = mkdtempSync(join(tmpdir(), "statusman-fresh-"));
  const previous = process.env.STATUSMAN_CONFIG;
  // A machine where statusman has never written anything has no directory yet.
  process.env.STATUSMAN_CONFIG = join(dir, "statusman", "settings.json");
  try {
    writeDisabled(new Set(["cwd"]));
    assert.deepEqual(read(process.env.STATUSMAN_CONFIG).disabled, ["cwd"]);
  } finally {
    if (previous === undefined) delete process.env.STATUSMAN_CONFIG;
    else process.env.STATUSMAN_CONFIG = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writing one setting leaves the others alone", () => {
  withSettingsFile((path) => {
    writeSettings((settings) => { settings.lines = 4; });
    writeDisabled(new Set(["cwd"]));
    assert.deepEqual(read(path), { lines: 4, disabled: ["cwd"] });
    assert.equal(readLines(), 4);
  });
});

test("--on, --off and --toggle each do what they say", () => {
  withSettingsFile(() => {
    assert.match(applyFlag("--off", ["cwd", "scoped"], readDisabled()), /cwd off, scoped off/);
    assert.deepEqual([...readDisabled()].sort(), ["cwd", "scoped"]);

    applyFlag("--on", ["cwd"], readDisabled());
    assert.deepEqual([...readDisabled()], ["scoped"]);

    applyFlag("--toggle", ["scoped", "org"], readDisabled());
    assert.deepEqual([...readDisabled()], ["org"]);
  });
});

test("a bad flag argument is refused before anything is written", () => {
  withSettingsFile((path) => {
    assert.throws(() => applyFlag("--off", [], readDisabled()), /needs at least one component id/);
    assert.throws(() => applyFlag("--off", ["nope"], readDisabled()), /unknown component: nope/);
    assert.throws(() => applyFlag("--off", ["org", "nope"], readDisabled()), /unknown component: nope/);
    assert.throws(() => readFileSync(path, "utf-8"), /ENOENT/);
  });
});

test("every component id is settable", () => {
  withSettingsFile(() => {
    applyFlag("--off", COMPONENT_IDS, readDisabled());
    assert.equal(readDisabled().size, COMPONENT_IDS.length);
    applyFlag("--on", COMPONENT_IDS, readDisabled());
    assert.equal(readDisabled().size, 0);
  });
});
