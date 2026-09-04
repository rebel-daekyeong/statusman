// refresh.js, the only part of statusman that talks to the network, and the
// staleness check that decides when it is sent out.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const { createServer } = require("node:http");
const { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, utimesSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const { shouldRefresh } = require("../statusline.js");

const REFRESH = join(__dirname, "..", "refresh.js");
const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);
const MINUTE = 60_000;

const SNAPSHOT = {
  five_hour: { utilization: 30, resets_at: "2026-09-04T16:50:00Z" },
  limits: [{ kind: "weekly_scoped", percent: 59, is_active: false, scope: { model: { display_name: "Fable" } } }],
};

/**
 * A config dir with a credentials file of its own. refresh.js reads the file
 * before the login keychain, so a run under this never sees the real token.
 */
async function sandbox(body) {
  const dir = mkdtempSync(join(tmpdir(), "statusman-refresh-"));
  const config = join(dir, ".claude");
  mkdirSync(config);
  writeFileSync(join(config, ".credentials.json"), JSON.stringify({
    claudeAiOauth: { accessToken: "sk-ant-oat-test", expiresAt: NOW + MINUTE },
  }));
  try {
    // Awaited, not returned: the directory has to outlive the run inside it.
    return await body({ dir, config, cache: join(dir, "usage.json") });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Serve one response, and report what the request carried. */
async function withServer(handler, body) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await body(`http://127.0.0.1:${server.address().port}/api/oauth/usage`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/**
 * Run refresh.js against `url`. Asynchronous on purpose: the server it talks to
 * lives in this process, which spawnSync would keep from ever answering.
 */
function run(paths, url, env = {}) {
  const child = spawn(process.execPath, [REFRESH], {
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: paths.config,
      STATUSMAN_USAGE_CACHE: paths.cache,
      STATUSMAN_USAGE_URL: url,
      ...env,
    },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolve) => child.on("close", (status) => resolve({ status, stderr })));
}

test("the snapshot is fetched with the account's token and cached whole", async () => {
  await sandbox(async (paths) => {
    const seen = [];
    const result = await withServer(
      (request, response) => {
        seen.push({ url: request.url, headers: request.headers });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(SNAPSHOT));
      },
      (url) => run(paths, url),
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "/api/oauth/usage");
    assert.equal(seen[0].headers.authorization, "Bearer sk-ant-oat-test");
    assert.equal(seen[0].headers["anthropic-beta"], "oauth-2025-04-20");

    const cached = JSON.parse(readFileSync(paths.cache, "utf-8"));
    assert.equal(typeof cached.fetchedAtMs, "number");
    // Under the key the statusline reads back, and with nothing dropped.
    assert.deepEqual(cached.utilization, SNAPSHOT);
  });
});

test("a refused request leaves the old snapshot in place", async () => {
  await sandbox(async (paths) => {
    writeFileSync(paths.cache, JSON.stringify({ fetchedAtMs: 1, utilization: { limits: [] } }));
    const result = await withServer(
      (_request, response) => { response.writeHead(401); response.end("no"); },
      (url) => run(paths, url),
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /answered 401/);
    assert.equal(JSON.parse(readFileSync(paths.cache, "utf-8")).fetchedAtMs, 1);
  });
});

test("with no token there is nothing to fetch with", async () => {
  await sandbox(async (paths) => {
    const empty = mkdtempSync(join(tmpdir(), "statusman-nocreds-"));
    try {
      // An empty config dir and no `security` on PATH: neither place a token
      // could come from has one, which is a fresh machine before `claude` runs.
      const result = await run(paths, "http://127.0.0.1:1/unused", { CLAUDE_CONFIG_DIR: empty, PATH: empty });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /no OAuth token/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

test("a fresh snapshot is left alone, a stale one is refetched", () => {
  const dir = mkdtempSync(join(tmpdir(), "statusman-stale-"));
  try {
    const lock = join(dir, "usage.json.lock");
    assert.equal(shouldRefresh({ fetchedAtMs: NOW - MINUTE }, lock, NOW), false);
    assert.equal(shouldRefresh({ fetchedAtMs: NOW - 11 * MINUTE }, lock, NOW), true);
    // No snapshot at all is as stale as it gets.
    assert.equal(shouldRefresh(undefined, lock, NOW), true);
    assert.equal(shouldRefresh({ fetchedAtMs: "soon" }, lock, NOW), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one fetch at a time, however often the statusline redraws", () => {
  const dir = mkdtempSync(join(tmpdir(), "statusman-lock-"));
  try {
    const lock = join(dir, "usage.json.lock");
    const stale = { fetchedAtMs: NOW - 11 * MINUTE };
    writeFileSync(lock, "");
    utimesSync(lock, new Date(NOW - 5_000), new Date(NOW - 5_000));
    // A request went out five seconds ago and has not landed yet.
    assert.equal(shouldRefresh(stale, lock, NOW), false);
    // One that has had a minute is taken as lost rather than in flight.
    utimesSync(lock, new Date(NOW - 2 * MINUTE), new Date(NOW - 2 * MINUTE));
    assert.equal(shouldRefresh(stale, lock, NOW), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
