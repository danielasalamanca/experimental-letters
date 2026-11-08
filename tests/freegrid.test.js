import { test } from "node:test";
import assert from "node:assert/strict";
import { createFont, createGlyph, normalizeFont, glyphGrid, shapeKey, GRIDS } from "../js/model.js";
import { glyphFinalContours } from "../js/shapes.js";
import { commandsToOutline } from "../js/nodes.js";

const square = [{ type: "M", x: 1, y: 0 }, { type: "L", x: 4, y: 0 }, { type: "L", x: 4, y: 5 }, { type: "L", x: 1, y: 5 }, { type: "Z" }];

test("the free grid is a third grid, with rounding like the squares", () => {
  assert.ok(GRIDS.free);
  const font = normalizeFont(createFont());
  font.grid = "free";
  assert.equal(glyphGrid(font, createGlyph({})), "free");
  assert.equal(shapeKey(font, createGlyph({})), "rounding");
});

test("on the free grid only the outline is drawn, never the cells", () => {
  const font = normalizeFont(createFont());
  font.grid = "free";
  const g = createGlyph({ cols: 6, cells: ["0,0", "1,0"] });
  assert.deepEqual(glyphFinalContours(font, g), []);
  g.outline = commandsToOutline([square]);
  const out = glyphFinalContours(font, g);
  assert.equal(out.length, 1);
  const corners = out[0].filter((c) => c.type === "M" || c.type === "L").map((c) => `${c.x},${c.y}`);
  assert.deepEqual([...new Set(corners)].sort(), ["1,0", "1,5", "4,0", "4,5"]);
});

test("a glyph can use the free grid in a font on another grid", () => {
  const font = normalizeFont(createFont());
  const g = createGlyph({ cells: ["0,0"], grid: "free" });
  assert.deepEqual(glyphFinalContours(font, g), []);
});

test("fonts without a snap spacing get the default", () => {
  const data = JSON.parse(JSON.stringify(createFont()));
  delete data.gridSpacing;
  delete data.gridSubdiv;
  const font = normalizeFont(data);
  assert.equal(font.gridSpacing, 10);
  assert.equal(font.gridSubdiv, 1);
});
