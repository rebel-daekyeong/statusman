// How the lines are laid out, and what gives way as the terminal narrows.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { MIN_BAR_CELLS, SEP, render, terminalColumns, textWidth } = require("../statusline.js");
const { COLUMNS, NOW, barCells, sources, strip } = require("./helpers.js");

const lines = (fixture, columns = COLUMNS, disabled, count) =>
  render(fixture, NOW, columns, disabled, count).map(strip);

test("the terminal's own indent is kept clear", () => {
  // Claude Code cut a row at 115 columns of a 119-column terminal; anything
  // wider loses the end of the last gauge to its truncation.
  assert.equal(terminalColumns({ COLUMNS: "119" }), 115);
  assert.equal(terminalColumns({ STATUSMAN_COLUMNS: "60", COLUMNS: "119" }), 56);
  // An unusable or absent width falls back rather than collapsing the layout.
  assert.ok(terminalColumns({ COLUMNS: "not a number" }) > MIN_BAR_CELLS);
  assert.ok(terminalColumns({}) > MIN_BAR_CELLS);
  assert.ok(terminalColumns({ COLUMNS: "1" }) >= MIN_BAR_CELLS);
});

test("the default layout is two lines", () => {
  const [top, bottom] = lines(sources());
  assert.equal(top, "Rebellions-Lime | daekyeong.kim | Opus 5 | xhigh | statusman | /Users/x/src/statusman");
  assert.equal(bottom.split(SEP).length, 4);
  assert.equal(lines(sources()).length, 2);
});

test("gauges carry no labels; what follows the percentage names them", () => {
  const [, bottom] = lines(sources());
  assert.ok(/ 13% 26k$/.test(bottom.split(SEP)[0]));
  assert.ok(bottom.endsWith(" 54% Fable"));
});

test("neither line overruns the terminal, at any width", () => {
  const korean = sources({
    stdin: {
      ...sources().stdin,
      session_name: "상태 표시 포팅",
      workspace: { current_dir: "/Users/daekyeong/src/statusman" },
    },
  });
  // The scoped gauge's trailer is a model name straight out of the usage
  // cache, so it can be wide too — and it is measured, not counted.
  const wideTrailer = sources();
  wideTrailer.cache.utilization.limits[1].scope.model.display_name = "오푸스다섯";
  for (const columns of [12, 25, 40, 45, 60, 80, 113, 200]) {
    for (const fixture of [sources(), korean, wideTrailer]) {
      for (const line of lines(fixture, columns)) {
        assert.ok(textWidth(line) <= columns, `${textWidth(line)} of ${columns}: ${line}`);
      }
    }
  }
});

test("the gauge row fills the terminal it is given", () => {
  const [, bottom] = lines(sources());
  // Slack is only ever the remainder left by splitting the bars evenly.
  assert.ok(textWidth(bottom) > COLUMNS - 5, `only ${textWidth(bottom)} of ${COLUMNS} columns`);
});

test("every bar in a row is the same width", () => {
  for (const columns of [80, 113, 200]) {
    const cells = lines(sources(), columns)[1].split(SEP).map(barCells);
    assert.equal(new Set(cells).size, 1, `bars differ at ${columns}: ${cells}`);
    assert.ok(cells[0] >= MIN_BAR_CELLS, `bars are ${cells[0]} cells at ${columns}`);
  }
});

test("under five cells the bars go rather than draw a stub", () => {
  // A two-block stub says nothing the percentage beside it does not.
  assert.equal(lines(sources(), 60)[1], "13% 26k | 30% 4h25m | 55% 2d14h | 54% Fable");
  assert.equal(lines(sources(), 45)[1], "13% 26k | 30% 4h25m | 55% 2d14h | 54% Fable");
});

test("the trailers go next, and only then whole gauges", () => {
  assert.equal(lines(sources(), 25)[1], "13% | 30% | 55% | 54%");
  assert.equal(lines(sources(), 12)[1], "13% | 30%");
});

test("the cwd rewrites itself from the front, then bows out", () => {
  assert.ok(lines(sources(), 113)[0].endsWith(" | /Users/x/src/statusman"));
  // Whole segments go first, so what is left is still a readable path.
  assert.ok(lines(sources(), 84)[0].endsWith(" | …/x/src/statusman"));
  assert.ok(lines(sources(), 78)[0].endsWith(" | …/src/statusman"));
  // Only a budget too small for that cuts inside the last segment.
  assert.ok(lines(sources(), 70)[0].endsWith(" | …tusman"));
  // Too narrow for even an ellipsis and two characters: the cwd is dropped.
  assert.ok(lines(sources(), 60)[0].endsWith("| statusman"));
});

test("text components clip their tails, and drop out with no room at all", () => {
  assert.ok(lines(sources(), 55)[0].endsWith("| sta…"));
  assert.equal(lines(sources(), 40)[0], "Rebellions-Lime | daekyeong.kim | Opus 5");
  assert.ok(lines(sources(), 24)[0].endsWith("…"));
});

test("the four-line layout gives every component its own row", () => {
  const tall = lines(sources(), COLUMNS, undefined, 4);
  assert.equal(tall.length, 4);
  assert.equal(tall[0], "Rebellions-Lime | daekyeong.kim | Opus 5 | xhigh");
  assert.equal(tall[1], "statusman | /Users/x/src/statusman");
  assert.equal(tall[2].split(SEP).length, 2);
  assert.equal(tall[3].split(SEP).length, 2);
});

test("one bar width covers both gauge rows", () => {
  // The rows carry different trailers, so laid out row by row they would land
  // a column or two apart and the block would read as ragged.
  const tall = lines(sources(), COLUMNS, undefined, 4);
  const cells = [...tall[2].split(SEP), ...tall[3].split(SEP)].map(barCells);
  assert.equal(new Set(cells).size, 1, `bars differ: ${cells}`);
  assert.ok(cells[0] > 16, `only ${cells[0]} cells with two gauges to a row`);
});

test("four lines shed their child views the same way", () => {
  for (const line of lines(sources(), 30, undefined, 4)) assert.ok(textWidth(line) <= 30, line);
  assert.equal(lines(sources(), 30, undefined, 4)[2], "13% 26k | 30% 4h25m");
});

test("an unknown line count falls back to the default", () => {
  for (const count of [0, 1, 3, 5, "4", undefined]) {
    assert.deepEqual(lines(sources(), COLUMNS, undefined, count), lines(sources()));
  }
});
