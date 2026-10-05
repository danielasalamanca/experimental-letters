import { test } from "node:test";
import assert from "node:assert/strict";
import * as opentype from "../js/vendor/opentype.min.js";
import { buildOtf, addTable, gposKerning } from "../js/otf.js";
import { normalizeFont, setKerning, advanceWidth } from "../js/model.js";

function sampleFont() {
  const font = normalizeFont(null);
  font.meta = { family: "Prueba Grilla", style: "Bold", designer: "Dani", version: "1.200" };
  font.glyphs.A.cells = ["0,0", "0,1", "1,2", "2,1", "2,0", "1,1"];
  font.glyphs.V.cells = ["0,2", "1,1", "1,0", "2,2"];
  font.glyphs.o.cells = ["0,0", "1,0", "2,0", "0,1", "2,1", "0,2", "1,2", "2,2"];
  setKerning(font, "A", "V", -60);
  setKerning(font, "V", "A", -40);
  setKerning(font, "T", "o", -30);
  return font;
}

test("the .otf has every glyph, names, metrics and advance widths", async () => {
  const font = sampleFont();
  const otf = opentype.parse(await buildOtf(font));
  const names = otf.names.windows;
  assert.equal(names.fontFamily.en, "Prueba Grilla");
  assert.equal(names.fontSubfamily.en, "Bold");
  assert.equal(names.designer.en, "Dani");
  assert.equal(names.version.en, "Version 1.200");
  assert.equal(otf.unitsPerEm, 1000);
  assert.equal(otf.ascender, 750);
  assert.equal(otf.descender, -250);
  assert.equal(otf.glyphs.length, 84); // .notdef + 83 characters
  const A = otf.charToGlyph("A");
  assert.equal(A.name, "A");
  assert.equal(A.advanceWidth, advanceWidth(font, font.glyphs.A));
  assert.equal(otf.charToGlyph("ñ").name, "ntilde");
  assert.ok(A.path.commands.length > 10);
  assert.equal(otf.charToGlyph(" ").path.commands.length, 0);
});

test("kerning pairs end up in GPOS", async () => {
  const otf = opentype.parse(await buildOtf(sampleFont()));
  assert.ok(otf.tables.gpos, "falta la tabla GPOS");
  const k = (a, b) => otf.getKerningValue(otf.charToGlyph(a), otf.charToGlyph(b));
  assert.equal(k("A", "V"), -60);
  assert.equal(k("V", "A"), -40);
  assert.equal(k("T", "o"), -30);
  assert.equal(k("A", "A"), 0);
});

test("checksums are valid after adding GPOS", async () => {
  const buffer = await buildOtf(sampleFont());
  const dv = new DataView(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.byteLength; i += 4) sum = (sum + dv.getUint32(i)) >>> 0;
  assert.equal(sum, 0xb1b0afba);
  // Every table record points inside the file, 4-byte aligned.
  const n = dv.getUint16(4);
  for (let i = 0; i < n; i++) {
    const offset = dv.getUint32(12 + i * 16 + 8), length = dv.getUint32(12 + i * 16 + 12);
    assert.equal(offset % 4, 0);
    assert.ok(offset + length <= buffer.byteLength);
  }
  // Replacing a table keeps a single copy.
  const again = new DataView(addTable(buffer, "GPOS", gposKerning([[1, 2, -10]])));
  assert.equal(again.getUint16(4), n);
});

test("raw export keeps tangent tips; the minimum join thickens them", async () => {
  const font = sampleFont();
  const join = opentype.parse(await buildOtf(font, { mode: "join" }));
  const raw = opentype.parse(await buildOtf(font, { mode: "raw" }));
  // Tip where the first two stars of the "o" touch: x = lsb + 1 cell, y = half a cell.
  const tip = (otf) => otf.charToGlyph("o").path.commands.filter((c) => c.x === 100 && c.y === 25).length;
  assert.equal(tip(raw), 2, "as is, the outline touches itself at the tip");
  assert.equal(tip(join), 0, "with the minimum join the tip is a 15-unit neck");
});

test("square-grid glyphs export filled or as an outline, and can mix with circles", async () => {
  const font = sampleFont();
  font.glyphs.o.grid = "squares"; // the "o" uses the dot grid, the rest circles
  font.rounding = 0.4;
  const contours = (otf) => otf.charToGlyph("o").path.commands.filter((c) => c.type === "M").length;
  const fill = opentype.parse(await buildOtf(font));
  assert.equal(contours(fill), 2); // ring: outside + counter
  font.style = "outline";
  const outline = opentype.parse(await buildOtf(font));
  assert.equal(contours(outline), 4); // each edge of the ring becomes a band
  // The "A" still uses the circle grid.
  assert.equal(fill.charToGlyph("A").path.commands.length, outline.charToGlyph("A").path.commands.length);
});

test("corner radii of the square grid reach the .otf, also through components", async () => {
  const font = sampleFont();
  font.grid = "squares";
  font.rounding = 0;
  font.glyphs.n.cols = 3;
  font.glyphs.n.cells = ["0,0", "0,1", "0,2", "1,2", "2,2", "2,1", "2,0"];
  const curves = (otf, ch) => otf.charToGlyph(ch).path.commands.filter((c) => c.type === "C").length;
  const sharp = opentype.parse(await buildOtf(font));
  assert.equal(curves(sharp, "n"), 0);
  font.glyphs.n.corners = { "0,3": "max", "3,3": "max" };
  const round = opentype.parse(await buildOtf(font));
  assert.equal(curves(round, "n"), 2);
  assert.equal(curves(round, "ñ"), 2, "la ñ hereda las esquinas de la n");
});

test("pieces reach the .otf as exact curves and diagonals", async () => {
  const font = sampleFont();
  font.grid = "squares";
  font.rounding = 0;
  const block = (x0, y0, x1, y1) => { const out = []; for (let c = x0; c < x1; c++) for (let r = y0; r < y1; r++) out.push(`${c},${r}`); return out; };
  Object.assign(font.glyphs.A, { cols: 8, cells: block(0, 0, 8, 14), pieces: [
    { x0: 0, y0: 0, x1: 3, y1: 14, corner: "tl", shape: "tri", mode: "cut" },
    { x0: 5, y0: 0, x1: 8, y1: 14, corner: "tr", shape: "tri", mode: "cut" },
  ] });
  Object.assign(font.glyphs.K, { cols: 8, cells: [...block(0, 0, 2, 14), ...block(2, 7, 8, 14)], pieces: [
    { x0: 2, y0: 7, x1: 5, y1: 14, corner: "tl", shape: "spandrel", mode: "cut" },
  ] });
  const otf = opentype.parse(await buildOtf(font));
  const types = (ch) => otf.charToGlyph(ch).path.commands.map((c) => c.type).join("");
  assert.equal(types("A").replace(/Z$/, ""), "MLLL"); // a trapezoid
  assert.equal((types("K").match(/C/g) ?? []).length, 1);
});
