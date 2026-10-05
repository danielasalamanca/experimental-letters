import { test } from "node:test";
import assert from "node:assert/strict";
import { joinBridges, neckWidth } from "../js/geometry.js";
import {
  createFont, migrateV1, normalizeFont, setMetric, fitCells, resizeBand,
  planFit, applyFit, DEFAULT_METRICS,
} from "../js/model.js";

const sorted = (cells) => [...cells].sort();

test("v1 data migrates to the baseline-based grid", () => {
  const font = migrateV1({
    cols: 9, rows: 10, curve: 0.8, ink: "#ff0000",
    filled: ["1,9", "8,1", "0,5"], // the last one was a border vertex: dropped
    gallery: [{ cols: 5, rows: 4, curve: 0.5, filled: ["1,3"] }],
  });
  assert.deepEqual(sorted(font.glyphs.a.cells), ["0,0", "7,8"]);
  assert.equal(font.glyphs.a.cols, 8);
  assert.equal(font.glyphs.a.curve, null);
  assert.equal(font.curve, 0.8);
  assert.equal(font.view.ink, "#ff0000");
  assert.deepEqual(font.drafts[0].cells, ["0,0"]);
  assert.equal(font.drafts[0].curve, 0.5);
});

test("normalizeFont keeps v2 data and fills defaults", () => {
  const font = normalizeFont(JSON.parse(JSON.stringify(createFont())));
  assert.deepEqual(font.metrics, DEFAULT_METRICS);
  assert.equal(normalizeFont(null).format, "experimental-letters");
});

test("metrics stay in order and on whole rows", () => {
  const m = { ascender: 15, capHeight: 14, xHeight: 9, descender: -5 };
  assert.equal(setMetric(m, "xHeight", 20).xHeight, 14);
  assert.equal(setMetric(m, "xHeight", 9.4).xHeight, 9);
  assert.equal(setMetric(m, "descender", 3).descender, -1);
  assert.equal(setMetric(m, "ascender", 2).ascender, 14);
});

test("resizeBand duplicates and removes repeated rows first", () => {
  const band = [[0, 4], [0], [0], [0, 4]];
  assert.deepEqual(resizeBand(band, 5), [[0, 4], [0], [0], [0], [0, 4]]);
  assert.deepEqual(resizeBand(band, 3), [[0, 4], [0], [0, 4]]);
  assert.deepEqual(resizeBand([], 2), [[], []]);
});

test("fitCells shifts rows above the change by whole rows", () => {
  const from = { ascender: 15, capHeight: 14, xHeight: 9, descender: -5 };
  const to = { ...from, xHeight: 10 };
  // A stem from the baseline to the x-height plus one ascender point.
  const cells = ["0,0", "0,1", "0,2", "0,3", "0,4", "0,5", "0,6", "0,7", "0,8", "0,12", "1,-3"];
  const out = fitCells(cells, from, to);
  assert.equal(out.filter((k) => k.startsWith("0,")).length, 11);
  assert.ok(out.includes("0,9"));      // stem grew one row
  assert.ok(out.includes("0,12"));     // above x-height zone: cap zone shrank by one
  assert.ok(out.includes("1,-3"));     // descender zone untouched
  for (const k of out) assert.ok(Number.isInteger(+k.split(",")[1]));
});

test("planFit counts only glyphs that actually change", () => {
  const font = createFont();
  font.drafts.push({ cols: 2, cells: [], curve: null, metrics: { ...font.metrics } });
  font.metrics = { ...font.metrics, xHeight: 10 };
  const plan = planFit(font);
  assert.equal(plan.pending.length, 2);
  assert.equal(plan.affected, 1);
  applyFit(font, plan);
  assert.equal(planFit(font).pending.length, 0);
  const tops = font.glyphs.a.cells.filter((k) => k.endsWith(",9"));
  assert.ok(tops.length > 0, "the 'a' now reaches the new x-height");
});

test("unión mínima bridges only tangent neighbours", () => {
  assert.equal(neckWidth(1), 0);
  const cells = ["0,0", "1,0", "0,1", "5,5"];
  const bridges = joinBridges(cells, 1, 0.3);
  assert.equal(bridges.length, 2);
  const [h] = bridges;
  assert.ok(Math.abs(h.h - 0.3) < 1e-9);
  // The bridge ends where the two circle arcs are exactly 0.3 apart.
  const half = h.w / 2;
  const gap = 1 - 2 * Math.sqrt(0.25 - half * half);
  assert.ok(Math.abs(gap - 0.3) < 1e-9);
  // Wide necks need no bridge.
  assert.equal(joinBridges(cells, 0.5, 0.3).length, 0);
});

test("every character of the set has a glyph; accents start as composites", async () => {
  const { CHARSET, ACUTE, TILDE } = await import("../js/charset.js");
  const font = normalizeFont(null);
  for (const char of CHARSET) assert.ok(font.glyphs[char], `falta ${char}`);
  assert.deepEqual(font.glyphs["á"].components.map((c) => c.glyph), ["a", ACUTE]);
  assert.equal(font.glyphs["Ñ"].components[1].glyph, TILDE);
  assert.equal(font.glyphs["Ñ"].components[1].dy, font.metrics.capHeight - font.metrics.xHeight);
  assert.equal(font.glyphs[" "].lsb, 0);
});

test("composites follow their components", async () => {
  const { resolvedCells, advanceWidth } = await import("../js/model.js");
  const { ACUTE } = await import("../js/charset.js");
  const font = normalizeFont(null);
  font.glyphs[ACUTE].cells = ["0,10"];
  const dx = font.glyphs["á"].components[1].dx;
  const before = resolvedCells(font, font.glyphs["á"]);
  assert.ok(before.includes(`${dx},10`));
  assert.equal(before.length, font.glyphs.a.cells.length + 1);
  font.glyphs.a.cells.push("7,7");
  assert.ok(resolvedCells(font, font.glyphs["á"]).includes("7,7"));
  assert.equal(advanceWidth(font, font.glyphs.a), 50 + 8 * 50 + 50);
});

test("components cannot create cycles", async () => {
  const { canUseComponent } = await import("../js/model.js");
  const font = normalizeFont(null);
  assert.equal(canUseComponent(font, "a", "á"), false); // á already uses a
  assert.equal(canUseComponent(font, "a", "a"), false);
  assert.equal(canUseComponent(font, "h", "n"), true);
});

test("glyph names are safe for files and the .otf", async () => {
  const { glyphName, fileName } = await import("../js/charset.js");
  assert.equal(glyphName("?"), "question");
  assert.equal(glyphName("7"), "seven");
  assert.equal(fileName("A"), "A-mayus");
  assert.equal(fileName("a"), "a");
});

test("the global rounding only applies when 'Redondear todas las esquinas' is on", async () => {
  const { glyphRounding } = await import("../js/model.js");
  const font = normalizeFont(null);
  font.rounding = 0.4;
  assert.equal(font.roundAll, false);
  assert.equal(glyphRounding(font, font.glyphs.a), 0);
  font.roundAll = true;
  assert.equal(glyphRounding(font, font.glyphs.a), 0.4);
  // A glyph's own rounding applies either way.
  font.roundAll = false;
  font.glyphs.a.rounding = 0.2;
  assert.equal(glyphRounding(font, font.glyphs.a), 0.2);
});
