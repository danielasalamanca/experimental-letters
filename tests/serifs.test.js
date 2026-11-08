import { test } from "node:test";
import assert from "node:assert/strict";
import { stemEnds, serifPieces, applySerifs, removeSerifs, isSerif } from "../js/serifs.js";
import { createFont, createGlyph, normalizeFont, DEFAULT_METRICS } from "../js/model.js";
import { glyphFinalContours } from "../js/shapes.js";

const M = DEFAULT_METRICS; // xHeight 9, capHeight 14, ascender 15, descender -5
const block = (x0, y0, x1, y1) => {
  const out = [];
  for (let c = x0; c < x1; c++) for (let r = y0; r < y1; r++) out.push(`${c},${r}`);
  return out;
};

function winding(contours, [px, py]) {
  let w = 0;
  for (const cmds of contours) {
    const pts = cmds.filter((c) => c.type !== "Z").map((c) => [c.x, c.y]);
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      if (y0 <= py && y1 > py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) > 0) w++;
      else if (y0 > py && y1 <= py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) < 0) w--;
    }
  }
  return w;
}

test("a stem on the baseline and the x-height has a foot and a head", () => {
  const ends = stemEnds(block(3, 0, 5, 9), M);
  assert.deepEqual(ends, [
    { x0: 3, x1: 5, edge: 0, kind: "foot" },
    { x0: 3, x1: 5, edge: 9, kind: "head" },
  ]);
});

test("bars and bowls are not stems", () => {
  // An L: its bottom bar is wider than the stem above it.
  const L = [...block(0, 0, 2, 14), ...block(2, 0, 6, 2)];
  const ends = stemEnds(L, M);
  assert.ok(!ends.some((e) => e.kind === "foot"));
  assert.equal(ends.filter((e) => e.kind === "head").length, 1);
});

test("serifs follow the chosen sides", () => {
  const cells = block(3, 0, 5, 9);
  const pieces = serifPieces(cells, M, { style: "slab", ext: 1, height: 1, footSide: "both", headSide: "left" });
  assert.equal(pieces.length, 2);
  const [foot, head] = pieces;
  assert.deepEqual([foot.x0, foot.x1, foot.y0, foot.y1], [2, 6, 0, 1]);
  assert.deepEqual([head.x0, head.x1, head.y0, head.y1], [2, 5, 8, 9]);
  assert.ok(pieces.every(isSerif));
  assert.equal(serifPieces(cells, M, { footSide: "none", headSide: "none" }).length, 0);
});

test("serif ink: slab, wedge and round add exactly their shape", () => {
  const font = normalizeFont(createFont());
  for (const style of ["slab", "wedge", "round"]) {
    const g = createGlyph({ cols: 8, cells: block(3, 0, 5, 9), metrics: M });
    applySerifs(g, M, { style, ext: 1, height: 1, wedge: 1, footSide: "both", headSide: "none" });
    const contours = glyphFinalContours(font, g);
    const w = (x, y) => winding(contours, [x, y]);
    assert.equal(w(4, 4), 1, style + ": stem");
    assert.equal(w(2.5, 0.5), 1, style + ": serif on the left of the foot");
    assert.equal(w(5.5, 0.5), 1, style + ": serif on the right of the foot");
    assert.equal(w(2.5, 4), 0, style + ": nothing beside the stem");
    assert.equal(w(1, 0.5), 0, style + ": beyond the serif");
    assert.equal(w(2.5, 8.5), 0, style + ": no head serif");
  }
});

test("applying again replaces the serifs; removing leaves the drawing alone", () => {
  const g = createGlyph({ cols: 8, cells: block(3, 0, 5, 9), metrics: M });
  const mine = { x0: 0, y0: 0, x1: 1, y1: 1, corner: "bl", shape: "tri", mode: "add" };
  g.pieces.push(mine);
  assert.equal(applySerifs(g, M, { footSide: "both", headSide: "both" }), 2);
  assert.equal(applySerifs(g, M, { footSide: "both", headSide: "both" }), 2);
  assert.equal(g.pieces.length, 3);
  assert.equal(removeSerifs(g), 2);
  assert.deepEqual(g.pieces, [mine]);
});

test("the serif mark survives a save and load", () => {
  const font = createFont();
  const g = createGlyph({ cols: 8, cells: block(3, 0, 5, 9), metrics: M });
  applySerifs(g, M, {});
  font.glyphs.l = g;
  const back = normalizeFont(JSON.parse(JSON.stringify(font)));
  assert.ok(back.glyphs.l.pieces.length > 0 && back.glyphs.l.pieces.every(isSerif));
});
