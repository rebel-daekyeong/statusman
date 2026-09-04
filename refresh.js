#!/usr/bin/env node
// Fetch the account's usage snapshot and cache it for the statusline.
//
// Run: node refresh.js
//
// This is the only part of statusman that touches the network. statusline.js
// spawns it in the background when its cache has gone stale and never waits for
// it: the request takes seconds, so the render that started it still draws from
// the old snapshot and the next one picks up the new.
//
// The snapshot carries the model-scoped weekly cap, which is the one gauge the
// statusline JSON on stdin has no field for.

"use strict";

const { writeFileSync } = require("fs");
const { execFileSync } = require("child_process");
const { join } = require("path");

const { claudeConfigDir, ensureDirFor, readJsonFile, usageCachePaths } = require("./statusline.js");

/** Undocumented, and the same endpoint `/usage` reads. */
const USAGE_URL = process.env.STATUSMAN_USAGE_URL || "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA = "oauth-2025-04-20";
/** The request took ~5s when measured, so the ceiling is generous. */
const TIMEOUT_MS = 20_000;

const oauthToken = (credentials) => {
  const oauth = credentials && credentials.claudeAiOauth;
  const token = oauth && oauth.accessToken;
  return typeof token === "string" && token ? token : undefined;
};

/**
 * The signed-in account's OAuth token. Claude Code keeps it in the login
 * keychain on macOS and in a file everywhere else; the file is read first so a
 * test can point CLAUDE_CONFIG_DIR at one of its own and never see the real one.
 */
function readToken() {
  const fromFile = oauthToken(readJsonFile(join(claudeConfigDir(), ".credentials.json")));
  if (fromFile || process.platform !== "darwin") return fromFile;
  try {
    const raw = execFileSync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return oauthToken(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

async function fetchUsage(token) {
  const response = await fetch(USAGE_URL, {
    headers: { authorization: `Bearer ${token}`, "anthropic-beta": OAUTH_BETA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${USAGE_URL} answered ${response.status}`);
  return response.json();
}

/**
 * Store the snapshot under the key the statusline reads it back from. The body
 * is kept whole: it carries more than the four gauges use, and a field that
 * turns out to matter later is then already there.
 */
function writeSnapshot(body) {
  const path = usageCachePaths()[0];
  ensureDirFor(path);
  writeFileSync(path, `${JSON.stringify({ fetchedAtMs: Date.now(), source: "api", utilization: body }, null, 2)}\n`);
  return path;
}

async function main() {
  const token = readToken();
  if (!token) throw new Error("no OAuth token — run `claude` once to sign in");
  return writeSnapshot(await fetchUsage(token));
}

module.exports = { readToken, writeSnapshot };

if (require.main === module) {
  main().then(
    (path) => console.log(`usage snapshot written to ${path}`),
    (error) => {
      // Nothing here is worth interrupting the statusline over: an expired
      // token or an unreachable API leaves the old snapshot in place.
      console.error(`refresh failed: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
