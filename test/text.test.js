// Width measurement and the two ways a component shortens itself.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { clip, fitPathTail, textWidth } = require("../statusline.js");

test("wide characters count as two columns", () => {
  assert.equal(textWidth("statusman"), 9);
  assert.equal(textWidth("상태 표시"), 9);
  assert.equal(textWidth(""), 0);
  // Counting these as one column each is what let the identity line overrun
  // the terminal and get truncated by Claude Code.
  assert.equal(textWidth("포팅"), 4);
});

test("clip cuts the tail and marks it", () => {
  assert.equal(clip("statusman", 20), "statusman");
  assert.equal(clip("statusman", 9), "statusman");
  assert.equal(clip("statusman", 6), "statu…");
  assert.equal(clip("statusman", 2), "s…");
  // Below two columns there is no room for content beside the ellipsis.
  assert.equal(clip("statusman", 1), "");
  assert.equal(clip("", 20), "");
});

test("clip never overruns its budget, wide characters included", () => {
  for (const text of ["statusman", "상태 표시 포팅", "a상b태c"]) {
    for (let budget = 0; budget <= textWidth(text) + 2; budget++) {
      assert.ok(textWidth(clip(text, budget)) <= budget, `${text} at ${budget}`);
    }
  }
});

test("fitPathTail drops whole segments from the front", () => {
  const path = "/Users/me/src/statusman";
  assert.equal(fitPathTail(path, 40), path);
  assert.equal(fitPathTail(path, 22), "…/me/src/statusman");
  assert.equal(fitPathTail(path, 16), "…/src/statusman");
  assert.equal(fitPathTail(path, 14), "…/statusman");
});

test("fitPathTail cuts inside the last segment only as a last resort", () => {
  const path = "/Users/me/src/statusman";
  assert.equal(fitPathTail(path, 8), "…atusman");
  assert.equal(fitPathTail(path, 3), "…an");
  // Two columns is all ellipsis and no path, so the component bows out.
  assert.equal(fitPathTail(path, 2), "");
  assert.equal(fitPathTail(undefined, 40), "");
});

test("fitPathTail never overruns its budget", () => {
  for (const path of ["/Users/me/src/statusman", "/a", "relative/dir", "/Users/대경/src"]) {
    for (let budget = 0; budget <= textWidth(path) + 2; budget++) {
      assert.ok(textWidth(fitPathTail(path, budget)) <= budget, `${path} at ${budget}`);
    }
  }
});
