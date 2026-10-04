import { test } from "node:test";
import assert from "node:assert/strict";
import { axisRows, mirrorKeys, translate, cellsInRect, connectedCells } from "../js/tools.js";

const m = { ascender: 15, capHeight: 14, xHeight: 9, descender: -5 };
const sorted = (a) => [...a].sort();

test("mirror axis follows the kind of character", () => {
  assert.deepEqual(axisRows("auto", m, "a"), [0, 9]);
  assert.deepEqual(axisRows("auto", m, "A"), [0, 14]);
  assert.deepEqual(axisRows("auto", m, "7"), [0, 14]);
  assert.deepEqual(axisRows("full", m, "a"), [-5, 15]);
});

test("mirrorKeys reflects across columns and rows", () => {
  assert.deepEqual(sorted(mirrorKeys("1,2", { h: true, cols: 8 })), ["1,2", "6,2"]);
  assert.deepEqual(sorted(mirrorKeys("1,2", { v: true, cols: 8, rows: [0, 9] })), ["1,2", "1,6"]);
  assert.deepEqual(sorted(mirrorKeys("1,2", { h: true, v: true, cols: 8, rows: [0, 9] })), ["1,2", "1,6", "6,2", "6,6"]);
  // A cell on the axis is its own mirror.
  assert.deepEqual(mirrorKeys("3,4", { h: true, v: true, cols: 7, rows: [0, 9] }), ["3,4"]);
});

test("translate and rectangle selection", () => {
  assert.deepEqual(translate(["0,0", "2,-1"], 1, 2), ["1,2", "3,1"]);
  const cells = ["0,0", "1,1", "4,4"];
  assert.deepEqual(cellsInRect(cells, 0, 0, 2, 2), ["0,0", "1,1"]);
  assert.deepEqual(cellsInRect(cells, 2, 2, 0, 0), ["0,0", "1,1"]);
});

test("connectedCells follows side neighbours, not diagonals", () => {
  const cells = ["0,0", "1,0", "1,1", "3,3", "2,2"];
  assert.deepEqual(sorted(connectedCells(cells, "0,0")), ["0,0", "1,0", "1,1"]);
  assert.deepEqual(connectedCells(cells, "9,9"), []);
});
