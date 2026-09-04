// The number and duration formats, and the meter itself.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { formatDuration, formatTokens, renderBar, toEpochMs } = require("../statusline.js");
const { NOW, strip } = require("./helpers.js");

test("token counts get a unit once they earn one", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(812), "812");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(102178), "102k");
  assert.equal(formatTokens(1_240_000), "1.2M");
  assert.equal(formatTokens(-1), "0");
  assert.equal(formatTokens(NaN), "0");
});

test("durations stay two units wide at most", () => {
  assert.equal(formatDuration(0), "<1m");
  assert.equal(formatDuration(30_000), "<1m");
  assert.equal(formatDuration(12 * 60_000), "12m");
  assert.equal(formatDuration(3600_000), "1h");
  assert.equal(formatDuration(3 * 3600_000 + 58 * 60_000), "3h58m");
  assert.equal(formatDuration(4 * 86400_000 + 13 * 3600_000), "4d13h");
  assert.equal(formatDuration(7 * 86400_000), "7d");
});

test("reset stamps arrive as epoch seconds or as ISO strings", () => {
  assert.equal(toEpochMs(NOW / 1000), NOW);
  assert.equal(toEpochMs(NOW), NOW);
  assert.equal(toEpochMs("2026-09-04T12:00:00.000Z"), NOW);
  for (const bad of [null, undefined, 0, -1, "", {}]) assert.ok(Number.isNaN(toEpochMs(bad)), String(bad));
});

test("a non-zero percentage always lights a cell", () => {
  assert.equal(strip(renderBar(0, 6)), "░░░░░░");
  assert.equal(strip(renderBar(1, 6)), "█░░░░░");
  assert.equal(strip(renderBar(50, 6)), "███░░░");
  assert.equal(strip(renderBar(100, 6)), "██████");
});

test("out-of-range percentages are clamped, not drawn past the end", () => {
  assert.equal(strip(renderBar(-5, 6)), "░░░░░░");
  assert.equal(strip(renderBar(140, 6)), "██████");
  assert.equal(strip(renderBar(NaN, 6)), "░░░░░░");
});

test("the tick marks how much of the window has run", () => {
  assert.equal(strip(renderBar(0, 6, 50)), "░░░|░░");
  assert.equal(strip(renderBar(100, 6, 100)), "█████|");
  // No elapsed share means no tick rather than a guessed position.
  assert.equal(strip(renderBar(50, 6)), "███░░░");
});

test("the bar is exactly as wide as it was asked to be", () => {
  for (const cells of [1, 4, 5, 16, 47]) {
    for (const percent of [0, 1, 37, 99, 100]) {
      assert.equal(strip(renderBar(percent, cells)).length, cells, `${percent}% in ${cells}`);
      assert.equal(strip(renderBar(percent, cells, 40)).length, cells, `${percent}% in ${cells} with tick`);
    }
  }
});
