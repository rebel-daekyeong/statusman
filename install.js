#!/usr/bin/env node
// Point Claude Code's statusLine setting at statusline.js.
//
// Run: node install.js [--settings <path>]
// The previous settings file is copied into statusman's own directory first,
// and any statusLine already configured is printed so it can be put back by
// hand. An existing backup is left alone: it holds the settings from before
// statusman was ever installed, which a second run would overwrite with its own.

"use strict";

const { readFileSync, writeFileSync, copyFileSync, existsSync } = require("fs");
const { join, resolve } = require("path");
const { homedir } = require("os");

const { ensureDirFor, statusmanDir } = require("./statusline.js");

const flagIndex = process.argv.indexOf("--settings");
const settingsPath = flagIndex !== -1 && process.argv[flagIndex + 1]
  ? resolve(process.argv[flagIndex + 1])
  : join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "settings.json");

const backupPath = join(statusmanDir(), "claude-settings.bak.json");
const hadSettings = existsSync(settingsPath);
const settings = hadSettings ? JSON.parse(readFileSync(settingsPath, "utf-8")) : {};

if (settings.statusLine) {
  console.log(`replacing statusLine: ${JSON.stringify(settings.statusLine)}`);
}

settings.statusLine = {
  type: "command",
  // `env node` rather than process.execPath: the running node may be a
  // version-pinned path (Homebrew's Cellar) that disappears on the next upgrade.
  command: `/usr/bin/env node ${resolve(__dirname, "statusline.js")}`,
  // padding 0: Claude Code already indents the statusline like the rest of its
  // output, and a padding of 1 shifts it one column right of everything else.
  padding: 0,
  refreshInterval: 5,
};

const backedUp = hadSettings && !existsSync(backupPath);
if (backedUp) {
  ensureDirFor(backupPath);
  copyFileSync(settingsPath, backupPath);
}
writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

console.log(`installed into ${settingsPath}`);
if (backedUp) console.log(`backup at ${backupPath}`);
else if (hadSettings) console.log(`backup kept from an earlier run: ${backupPath}`);
