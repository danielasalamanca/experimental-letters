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

import { selectionExtras, translateCorner, translatePiece } from "../js/tools.js";

test("corners and pieces travel with the cells they belong to", () => {
  const glyph = {
    cells: ["0,0", "1,0", "5,5"],
    corners: { "0,1": 2, "2,0": "max", "5,6": 1, "1.5,0.5": 0.5 },
    pieces: [
      { x0: 0, y0: 0, x1: 2, y1: 1, corner: "tl", shape: "tri", mode: "cut" },   // inside the selection
      { x0: 4, y0: 4, x1: 6, y1: 6, corner: "bl", shape: "quarter", mode: "add" }, // elsewhere
    ],
  };
  const { corners, pieces } = selectionExtras(glyph, new Set(["0,0", "1,0"]));
  assert.deepEqual(corners.sort(), ["0,1", "1.5,0.5", "2,0"]);
  assert.deepEqual(pieces, [0]);
  assert.equal(translateCorner("1.5,0.5", 2, -1), "3.5,-0.5");
  const moved = translatePiece({ x0: 0, y0: 0, x1: 2, y1: 1, points: [[0, 1], [2, 1], [0, 0]] }, 3, 4);
  assert.deepEqual([moved.x0, moved.x1, moved.y0, moved.y1], [3, 5, 4, 5]);
  assert.deepEqual(moved.points, [[3, 5], [5, 5], [3, 4]]);
});

import { transformMap, cellsBox, transformCells, transformCorner, transformPiece, transformContour } from "../js/tools.js";
import { pieceContour } from "../js/pieces.js";

// An L: a column of three cells with a foot to the right.
const L = ["0,0", "1,0", "0,1", "0,2"];

test("flipping cells keeps them in their box", () => {
  const box = cellsBox(L);
  assert.deepEqual(box, { x0: 0, x1: 2, y0: 0, y1: 3 });
  assert.deepEqual(sorted(transformCells(L, transformMap("h", box).point)), sorted(["1,0", "0,0", "1,1", "1,2"]));
  assert.deepEqual(sorted(transformCells(L, transformMap("v", box).point)), sorted(["0,2", "1,2", "0,1", "0,0"]));
});

test("four quarter turns bring cells back; cw then ccw too", () => {
  let cells = L;
  for (let i = 0; i < 4; i++) cells = transformCells(cells, transformMap("cw", cellsBox(cells)).point);
  assert.deepEqual(sorted(cells), sorted(L));
  const turned = transformCells(L, transformMap("cw", cellsBox(L)).point);
  assert.deepEqual(cellsBox(turned).x1 - cellsBox(turned).x0, 3);
  assert.deepEqual(sorted(transformCells(turned, transformMap("ccw", cellsBox(turned)).point)), sorted(L));
});

test("a quarter turn clockwise lays the column down to the right", () => {
  const out = transformCells(["0,0", "0,1", "0,2"], transformMap("cw", { x0: 0, x1: 1, y0: 0, y1: 3 }).point);
  const box = cellsBox(out);
  assert.equal(box.y1 - box.y0, 1);
  assert.equal(box.x1 - box.x0, 3);
});

test("corners and pieces follow the transform", () => {
  const { point } = transformMap("h", { x0: 0, x1: 4, y0: 0, y1: 2 });
  assert.equal(transformCorner("0,0", point), "4,0");
  const tri = { x0: 0, y0: 0, x1: 2, y1: 1, corner: "bl", shape: "tri", mode: "add" };
  const flipped = transformPiece(tri, point);
  assert.deepEqual([flipped.x0, flipped.x1, flipped.corner], [2, 4, "br"]);
  const quarter = { x0: 0, y0: 0, x1: 2, y1: 1, corner: "tl", shape: "quarter", mode: "cut" };
  const turned = transformPiece(quarter, transformMap("cw", { x0: 0, x1: 2, y0: 0, y1: 2 }).point);
  // Same shape: the box is just turned (2 wide, 1 high → 1 wide, 2 high).
  assert.equal(turned.x1 - turned.x0, 1);
  assert.equal(turned.y1 - turned.y0, 2);
  assert.equal(turned.mode, "cut");
  const area = (cmds) => cmds.filter((c) => c.type !== "Z").length;
  assert.equal(area(pieceContour(turned)), area(pieceContour(quarter)));
  const moved = { ...tri, points: [[0, 0], [2, 0], [1, 1]] };
  assert.deepEqual(transformPiece(moved, point).points, [[4, 0], [2, 0], [3, 1]]);
});

test("a flipped contour is reversed with its handles swapped", () => {
  const c = { closed: true, nodes: [{ x: 0, y: 0, in: null, out: [1, 0] }, { x: 2, y: 0, in: [0, -1], out: null }, { x: 2, y: 2, in: null, out: null }] };
  const out = transformContour(c, transformMap("h", { x0: 0, x1: 2, y0: 0, y1: 2 }), true);
  assert.deepEqual(out.nodes.map((n) => [n.x, n.y]), [[0, 2], [0, 0], [2, 0]]);
  assert.deepEqual(out.nodes[1], { x: 0, y: 0, in: null, out: [0, -1] });
  assert.deepEqual(out.nodes[2], { x: 2, y: 0, in: [-1, 0], out: null });
});

test("every piece shape keeps its exact outline when turned or flipped", () => {
  // Ellipses and capsules always start at the bottom, so the closing point
  // can differ: the set of points is what must match.
  const ends = (cmds) => [...new Set(cmds.filter((c) => c.type !== "Z").map((c) => `${Math.round(c.x * 1e6) / 1e6},${Math.round(c.y * 1e6) / 1e6}`))].sort();
  for (const shape of ["tri", "quarter", "spandrel", "ellipse", "pill"]) {
    for (const corner of ["bl", "br", "tl", "tr"]) {
      const p = { x0: 1, y0: 2, x1: 4, y1: 3, corner, shape, mode: "add" };
      for (const kind of ["cw", "ccw", "h", "v"]) {
        const { point } = transformMap(kind, { x0: 0, x1: 5, y0: 0, y1: 4 });
        const expected = pieceContour(p).filter((c) => c.type !== "Z").map((c) => {
          const [x, y] = point([c.x, c.y]);
          return { x, y };
        });
        assert.deepEqual(ends(pieceContour(transformPiece(p, point))), ends(expected), `${shape} ${corner} ${kind}`);
      }
    }
  }
});
