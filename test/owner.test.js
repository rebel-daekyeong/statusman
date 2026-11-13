// readSessionOwner: which org a session's transcript says it is signed in to.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const { readSessionOwner } = require("../statusline.js");

const owner = (org) => JSON.stringify({ type: "session-owner", accountUuid: "acct", organizationUuid: org, sessionId: "s" });
const message = (text) => JSON.stringify({ type: "user", message: { role: "user", content: text } });

/** Run `body` with a transcript made of `lines`. */
function withTranscript(lines, body) {
  const dir = mkdtempSync(join(tmpdir(), "statusman-owner-"));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, `${lines.join("\n")}\n`);
  try {
    return body(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the last stamp is the one that holds", () => {
  withTranscript([owner("org-a"), message("hi"), owner("org-b"), message("bye")], (path) => {
    assert.deepEqual(readSessionOwner(path), { organizationUuid: "org-b" });
  });
});

test("a stamp quoted inside a message does not count", () => {
  withTranscript([owner("org-a"), message(owner("org-b"))], (path) => {
    assert.deepEqual(readSessionOwner(path), { organizationUuid: "org-a" });
  });
});

test("a transcript without a stamp, or none at all, has no owner", () => {
  withTranscript([message("hi")], (path) => assert.equal(readSessionOwner(path), undefined));
  assert.equal(readSessionOwner(join(tmpdir(), "statusman-no-such-transcript.jsonl")), undefined);
  assert.equal(readSessionOwner(undefined), undefined);
});
