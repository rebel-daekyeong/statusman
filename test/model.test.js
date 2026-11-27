// buildContext: what each component is handed, and where it came from.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { buildContext } = require("../statusline.js");
const { NOW, sources } = require("./helpers.js");

test("identity comes from the account block and stdin", () => {
  const context = buildContext(sources(), NOW);
  assert.equal(context.org, "Rebellions-Lime");
  assert.equal(context.account, "daekyeong.kim");
  assert.equal(context.model, "Opus 5");
  assert.equal(context.effort, "⣶");
  assert.equal(context.session, "statusman");
  assert.equal(context.cwd, "/Users/x/src/statusman");
});

test("each effort level prints as one glyph, and an unknown one as its name", () => {
  const effort = (level) => buildContext(sources({ stdin: { ...sources().stdin, effort: { level } } }), NOW).effort;
  const glyphs = ["low", "medium", "high", "xhigh", "max"].map(effort);
  assert.deepEqual(glyphs, ["⡀", "⣀", "⣤", "⣶", "⣿"]);
  assert.equal(effort("ultra"), "ultra");
  assert.equal(effort("toString"), "toString");
});

test("the model id stands in for a missing display name", () => {
  const stdin = { ...sources().stdin, model: { id: "claude-opus-5" } };
  assert.equal(buildContext(sources({ stdin }), NOW).model, "claude-opus-5");
});

test("an unnamed session falls back to the directory's basename", () => {
  const stdin = { ...sources().stdin, session_name: undefined };
  assert.equal(buildContext(sources({ stdin }), NOW).session, "statusman");
});

test("the peer name is the newest record of this session's id", () => {
  const stdin = { ...sources().stdin, session_id: "s1" };
  const sessions = [
    { sessionId: "s2", name: "rblnc-58", updatedAt: 3 },
    { sessionId: "s1", name: "statusman-1f", updatedAt: 1 },
    { sessionId: "s1", name: "statusman-2b", updatedAt: 2 },
    undefined,
  ];
  const context = buildContext(sources({ stdin, sessions }), NOW);
  assert.equal(context.peer, "statusman-2b");
  assert.equal(context.session, "statusman");
  assert.equal(buildContext(sources({ sessions }), NOW).peer, undefined, "no session id on stdin");
});

test("nothing readable leaves every field undefined", () => {
  const context = buildContext({ stdin: undefined, config: undefined, cache: undefined }, NOW);
  for (const key of ["org", "account", "model", "effort", "peer", "session", "cwd", "context", "scoped"]) {
    assert.equal(context[key], undefined, key);
  }
});

test("the context gauge reports tokens used, not the window size", () => {
  assert.deepEqual(buildContext(sources(), NOW).context, { percent: 13, trailer: "26k" });
});

test("a missing token count is derived from the percentage", () => {
  const stdin = {
    ...sources().stdin,
    context_window: { used_percentage: 50, context_window_size: 200000 },
  };
  assert.equal(buildContext(sources({ stdin }), NOW).context.trailer, "100k");
});

test("with no token count and no window size the gauge goes without a trailer", () => {
  const stdin = { ...sources().stdin, context_window: { used_percentage: 50 } };
  assert.deepEqual(buildContext(sources({ stdin }), NOW).context, { percent: 50, trailer: undefined });
});

test("live rate limits on stdin win over the cached snapshot", () => {
  const cache = {
    utilization: {
      five_hour: { utilization: 99, resets_at: "2026-09-04T13:00:00.000Z" },
      seven_day: { utilization: 99, resets_at: "2026-09-05T13:00:00.000Z" },
      limits: [],
    },
  };
  const context = buildContext(sources({ cache }), NOW);
  assert.equal(context.fiveHour.percent, 30);
  assert.equal(context.sevenDay.percent, 55);
  assert.equal(context.fiveHour.trailer, "4h25m");
  assert.equal(context.sevenDay.trailer, "2d14h");
});

test("the cache fills the windows in when stdin carries none", () => {
  const stdin = { ...sources().stdin, rate_limits: undefined };
  const cache = {
    utilization: {
      five_hour: { utilization: 16, resets_at: "2026-09-04T16:00:00.000Z" },
      seven_day: { utilization: 53, resets_at: "2026-09-07T02:00:00.000Z" },
      limits: [],
    },
  };
  const context = buildContext(sources({ stdin, cache }), NOW);
  assert.equal(context.fiveHour.percent, 16);
  assert.equal(context.fiveHour.trailer, "4h");
  assert.equal(context.sevenDay.percent, 53);
});

test("the scoped gauge names the model its cap belongs to", () => {
  const scoped = buildContext(sources(), NOW).scoped;
  assert.equal(scoped.percent, 54);
  assert.equal(scoped.trailer, "Fable");
});

test("a snapshot is drawn only for the org signed in to now", () => {
  const PLUM = "b8bf4ea6-0000-4000-8000-000000000000";
  const LIME = "954766a2-0000-4000-8000-000000000000";
  const stamped = (org) => ({ ...sources().cache, organizationUuid: org });
  const signedIn = (org) => ({ oauthAccount: { ...sources().config.oauthAccount, organizationUuid: org } });
  const scoped = (config, cache) => buildContext(sources({ config, cache }), NOW).scoped;
  // Fetched before a switch to Lime: Plum's limits, not Lime's.
  assert.equal(scoped(signedIn(LIME), stamped(PLUM)), undefined);
  assert.equal(scoped(signedIn(PLUM), stamped(PLUM)).percent, 54);
  // Either side unknown — an account block without a uuid, a snapshot another tool left — is taken on trust.
  assert.equal(scoped(sources().config, stamped(PLUM)).percent, 54);
  assert.equal(scoped(signedIn(LIME), sources().cache).percent, 54);
});

test("the binding scoped cap wins when several models report one", () => {
  const cache = {
    utilization: {
      limits: [
        { kind: "weekly_scoped", percent: 10, is_active: false, scope: { model: { display_name: "Opus" } } },
        { kind: "weekly_scoped", percent: 80, is_active: true, scope: { model: { display_name: "Fable" } } },
      ],
    },
  };
  assert.equal(buildContext(sources({ cache }), NOW).scoped.trailer, "Fable");
});

test("an inactive scoped cap is still shown", () => {
  // is_active marks which limit is currently binding, not whether it exists.
  const cache = {
    utilization: {
      limits: [{ kind: "weekly_scoped", percent: 7, is_active: false, scope: null }],
    },
  };
  const scoped = buildContext(sources({ cache }), NOW).scoped;
  assert.equal(scoped.percent, 7);
  assert.equal(scoped.trailer, "scoped");
});

test("with no scoped cap the gauge falls back to credits", () => {
  const stdin = {
    ...sources().stdin,
    rate_limits: {
      ...sources().stdin.rate_limits,
      spend_limit: { used_percentage: 12, resets_at: (NOW + 3600_000) / 1000 },
    },
  };
  const cache = { utilization: { limits: [] } };
  assert.deepEqual(buildContext(sources({ stdin, cache }), NOW).scoped, {
    percent: 12,
    resetsAt: (NOW + 3600_000) / 1000,
    trailer: "1h",
  });

  const enabled = { utilization: { limits: [], extra_usage: { is_enabled: true, utilization: 42 } } };
  assert.deepEqual(buildContext(sources({ cache: enabled }), NOW).scoped, { percent: 42, trailer: "credits" });
});

test("an account with neither gets no scoped gauge at all", () => {
  const cache = { utilization: { limits: [], extra_usage: { is_enabled: false, utilization: null } } };
  assert.equal(buildContext(sources({ cache }), NOW).scoped, undefined);
});
