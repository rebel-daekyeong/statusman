// Components as a set: what each id contributes, and what happens without it.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { COMPONENTS, COMPONENT_IDS, LINE_COUNTS, SEP, render } = require("../statusline.js");
const { COLUMNS, NOW, sources, strip } = require("./helpers.js");

const lines = (disabled, count) => render(sources(), NOW, COLUMNS, disabled, count).map(strip);

test("every component declares an id, a kind and a row in each layout", () => {
  assert.equal(new Set(COMPONENT_IDS).size, COMPONENTS.length, "ids are not unique");
  for (const component of COMPONENTS) {
    assert.ok(["text", "path", "gauge"].includes(component.kind), component.id);
    assert.equal(typeof component.pick, "function", component.id);
    for (const count of LINE_COUNTS) {
      const row = component.line[count];
      assert.ok(Number.isInteger(row) && row >= 1 && row <= count, `${component.id} in ${count} lines: ${row}`);
    }
    // Only the gauges are colored by level; the rest carry their own color.
    if (component.kind !== "gauge") assert.match(component.color, /^\x1b\[/, component.id);
  }
});

test("each layout uses every one of its rows", () => {
  for (const count of LINE_COUNTS) {
    const rows = new Set(COMPONENTS.map((component) => component.line[count]));
    assert.deepEqual([...rows].sort(), Array.from({ length: count }, (_, i) => i + 1), `${count} lines`);
  }
});

test("switching a component off removes exactly its own text", () => {
  const [top] = lines(new Set(["org", "account", "cwd"]));
  assert.equal(top, "Opus 5 | xhigh | statusman");
  assert.equal(lines(new Set(["scoped"]))[1].split(SEP).length, 3);
});

test("the columns a component gave up go to the rest", () => {
  const wide = lines(new Set(["scoped"]))[1];
  const narrow = lines(new Set())[1];
  const cells = (row) => row.split(SEP)[0].match(/^[█░|]*/)[0].length;
  assert.ok(cells(wide) > cells(narrow), `${cells(wide)} should beat ${cells(narrow)}`);
});

test("a row left with nothing disappears instead of printing blank", () => {
  assert.equal(lines(new Set(["session", "cwd"]), 4).length, 3);
  assert.equal(lines(new Set(["ctx", "5h"]), 4).length, 3);
  assert.deepEqual(lines(new Set(COMPONENT_IDS)), []);
  assert.deepEqual(lines(new Set(COMPONENT_IDS), 4), []);
});

test("a component with no data leaves no trace either", () => {
  const stdin = { ...sources().stdin, effort: undefined, session_name: undefined, workspace: undefined };
  const [top] = render(sources({ stdin }), NOW, COLUMNS).map(strip);
  assert.equal(top, "Rebellions-Lime | daekyeong.kim | Opus 5");
});

test("nothing readable at all prints nothing", () => {
  assert.deepEqual(render({ stdin: undefined, config: undefined, cache: undefined }, NOW, COLUMNS), []);
});
