import { test } from "node:test";
import assert from "node:assert/strict";
import * as opentype from "../js/vendor/opentype.min.js";
import { buildVariableTtf, toQuadratic } from "../js/variable.js";
import { buildOtf, readSfnt } from "../js/otf.js";
import { normalizeFont, advanceWidth, setKerning } from "../js/model.js";
import { refreshBold } from "../js/masters.js";

function sample() {
  const f = normalizeFont(null);
  f.meta.family = "Prueba Variable";
  f.glyphs.l.cells = ["0,0", "0,1", "0,2", "0,3"];
  f.glyphs.l.cols = 1;
  setKerning(f, "l", "a", -20);
  return f;
}

test("the variable font has a weight axis with named weights", async () => {
  const buf = await buildVariableTtf(sample());
  const otf = opentype.parse(buf);
  assert.equal(otf.outlinesFormat, "truetype");
  assert.equal(otf.glyphs.length, 89);
  const [axis] = otf.tables.fvar.axes;
  assert.deepEqual([axis.tag, axis.minValue, axis.defaultValue, axis.maxValue], ["wght", 400, 400, 800]);
  assert.deepEqual(otf.tables.fvar.instances.map((i) => i.name.en), ["Regular", "Medium", "SemiBold", "Bold", "ExtraBold"]);
  const { tables } = readSfnt(buf);
  for (const tag of ["glyf", "loca", "gvar", "fvar", "STAT", "GPOS", "hmtx", "maxp"]) assert.ok(tables.has(tag), tag);
  assert.ok(!tables.has("CFF "));
  assert.equal(new DataView(tables.get("OS/2").buffer).getUint16(4), 400);
});

test("glyf outlines match the Regular and widths come from it", async () => {
  const f = sample();
  const otf = opentype.parse(await buildVariableTtf(f));
  const l = otf.charToGlyph("l");
  assert.equal(l.advanceWidth, advanceWidth(f, f.glyphs.l));
  const box = l.getBoundingBox();
  assert.deepEqual([box.x1, box.x2, box.y1, box.y2], [50, 100, 0, 200]);
});

test("both masters become quadratics with the same points", () => {
  const K = 0.5522847498;
  const arc = (r) => [[
    { type: "M", x: r, y: 0 },
    { type: "C", x1: r, y1: K * r, x2: K * r, y2: r, x: 0, y: r },
    { type: "L", x: 0, y: 0 },
    { type: "Z" },
  ]];
  const [a, b] = toQuadratic(arc(100), arc(300));
  assert.equal(a.contours[0].points.length, b.contours[0].points.length);
  assert.deepEqual(a.contours[0].points.map((p) => p.on), b.contours[0].points.map((p) => p.on));
  assert.ok(a.contours[0].points.some((p) => !p.on));
});

test("a weight in between exports as its own static font", async () => {
  const f = sample();
  refreshBold(f, "l");
  const otf = opentype.parse(await buildOtf(f, { weight: 600 }));
  assert.equal(otf.names.windows.fontSubfamily.en, "SemiBold");
  assert.equal(otf.tables.os2.usWeightClass, 600);
  const l = otf.charToGlyph("l");
  assert.equal(l.advanceWidth, advanceWidth(f, f.glyphs.l) + 20);
  const box = l.getBoundingBox();
  assert.deepEqual([box.x1, box.x2], [50, 120]);
  const regular = opentype.parse(await buildOtf(f));
  assert.equal(regular.tables.os2.usWeightClass, 400);
});
