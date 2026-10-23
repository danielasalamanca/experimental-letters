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
  assert.equal(font.glyphs["Ñ"].components[1].glyph, "˜.case");
  assert.equal(font.glyphs["Ñ"].components[1].dy, 0);
  assert.deepEqual(font.glyphs["˜.case"].components, [{ glyph: TILDE, dx: 0, dy: font.metrics.capHeight - font.metrics.xHeight }]);
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

test("resetting a letter gives back a fresh one", async () => {
  const { defaultGlyph, createGlyph } = await import("../js/model.js");
  const font = normalizeFont(null);
  font.glyphs.n = createGlyph({ cols: 12, cells: ["0,0"], lsb: 7, corners: { "0,1": 2 }, pieces: [{ x0: 0, y0: 0, x1: 1, y1: 1, corner: "bl", shape: "tri", mode: "cut" }], outline: [], grid: "squares", curve: 0.5 });
  const fresh = defaultGlyph(font, "n");
  assert.deepEqual([fresh.cells, fresh.pieces, fresh.corners, fresh.outline, fresh.grid, fresh.curve], [[], [], {}, null, null, null]);
  assert.equal(fresh.cols, 8);
  assert.equal(fresh.lsb, font.cell);
  // An accented letter comes back as letter + accent.
  assert.deepEqual(defaultGlyph(font, "ñ").components.map((c) => c.glyph), ["n", "˜"]);
});

test("accented capitals are composites with the case accent", async () => {
  const { CHARSET, glyphName, isCapital } = await import("../js/charset.js");
  const font = normalizeFont(null);
  for (const [char, base] of [["Á", "A"], ["É", "E"], ["Í", "I"], ["Ó", "O"], ["Ú", "U"], ["Ü", "U"]]) {
    assert.ok(CHARSET.includes(char));
    const mark = char === "Ü" ? "¨.case" : "´.case";
    assert.deepEqual(font.glyphs[char].components.map((c) => [c.glyph, c.dy]), [[base, 0], [mark, 0]]);
  }
  assert.equal(glyphName("Á"), "Aacute");
  assert.ok(isCapital("Á") && isCapital("Ñ") && isCapital("7") && !isCapital("á"));
  // Fonts saved before get them too.
  const old = JSON.parse(JSON.stringify(font));
  delete old.glyphs["É"];
  assert.ok(normalizeFont(old).glyphs["É"]);
});

import { zoneRows, setZoneRows } from "../js/model.js";

test("rows per zone: adding rows to a zone moves the lines above it", () => {
  const m = { ascender: 15, capHeight: 14, xHeight: 9, descender: -5 };
  assert.deepEqual(zoneRows(m), { top: 1, caps: 5, x: 9, desc: 5 });
  assert.deepEqual(setZoneRows(m, "x", 11), { ascender: 17, capHeight: 16, xHeight: 11, descender: -5 });
  assert.deepEqual(setZoneRows(m, "top", 3), { ascender: 17, capHeight: 14, xHeight: 9, descender: -5 });
  assert.deepEqual(setZoneRows(m, "desc", 2), { ascender: 15, capHeight: 14, xHeight: 9, descender: -2 });
  assert.deepEqual(setZoneRows(m, "caps", 0), { ascender: 10, capHeight: 9, xHeight: 9, descender: -5 });
});

test("rows per zone stay within limits", () => {
  const m = { ascender: 15, capHeight: 14, xHeight: 9, descender: -5 };
  assert.equal(setZoneRows(m, "x", 0).xHeight, 1);
  assert.equal(setZoneRows(m, "desc", 0).descender, -1);
  assert.equal(setZoneRows(m, "desc", 99).descender, -40);
  assert.equal(setZoneRows(m, "top", 999).ascender, 60);
  assert.equal(setZoneRows(m, "top", -3).ascender, 14);
});

test("accents are centered on the ink of their letter, in whole columns", async () => {
  const { defaultGlyph, centeredDx, inkSpan } = await import("../js/model.js");
  const { ACUTE, DIERESIS } = await import("../js/charset.js");
  const font = normalizeFont(null);
  // A 3-column i drawn in the middle column, and a one-column acute drawn
  // in the third column of its 4.
  font.glyphs.i.cells = ["1,0", "1,1", "1,2", "1,3"];
  font.glyphs[ACUTE].cells = ["2,10"];
  assert.deepEqual(inkSpan(font, font.glyphs.i), [1, 2]);
  const í = defaultGlyph(font, "í");
  assert.equal(í.components[1].dx, -1); // the accent's ink lands on column 1
  assert.equal(centeredDx(font, í, 1), -1);
  // Empty letters fall back to centering by columns.
  assert.equal(centeredDx(font, font.glyphs["ü"], 1), null);
  assert.deepEqual(font.glyphs["ü"].components.map((c) => c.glyph), ["u", DIERESIS]);
  // Odd differences leave the extra half column on the left.
  font.glyphs.i.cells = ["0,0", "1,0"];
  assert.equal(centeredDx(font, í, 1), -2);
});

test("case marks: named like Glyphs, no code point, raised accent by default", async () => {
  const { ACUTE, glyphName, codepoint, isCapital, baseChar } = await import("../js/charset.js");
  const { charUnicodes, resolvedCells } = await import("../js/model.js");
  const font = normalizeFont(null);
  assert.equal(glyphName("´.case"), "acute.case");
  assert.equal(glyphName("¨.case"), "dieresis.case");
  assert.equal(codepoint("´.case"), "sin código");
  assert.deepEqual(charUnicodes(font, "´.case"), []);
  assert.ok(isCapital("´.case"));
  assert.equal(baseChar("´.case"), ACUTE);
  // Drawing the case mark changes the capitals only.
  font.glyphs[ACUTE].cells = ["1,10"];
  font.glyphs["´.case"].components = [];
  font.glyphs["´.case"].cells = ["1,15"];
  const at = (char) => resolvedCells(font, font.glyphs[char]).filter((k) => +k.split(",")[1] >= 10);
  const dx = (char) => font.glyphs[char].components[1].dx;
  assert.deepEqual(at("á"), [`${1 + dx("á")},10`]);
  assert.deepEqual(at("Á"), [`${1 + dx("Á")},15`]);
});

test("older fonts switch their capitals to the case marks without changing their look", async () => {
  const { resolvedCells } = await import("../js/model.js");
  const font = normalizeFont(null);
  font.glyphs["´"].cells = ["0,10", "1,11"];
  font.glyphs.A.cells = ["0,0", "1,1"];
  const lift = font.metrics.capHeight - font.metrics.xHeight;
  // As saved before: Á = A + ´ raised by hand, no case marks.
  const old = JSON.parse(JSON.stringify(font));
  for (const k of ["´.case", "˜.case", "¨.case"]) delete old.glyphs[k];
  old.glyphs["Á"].components = [{ glyph: "A", dx: 0, dy: 0 }, { glyph: "´", dx: 3, dy: lift + 1 }];
  old.glyphs["É"].components = [{ glyph: "E", dx: 0, dy: 0 }, { glyph: "´", dx: 2, dy: lift, erase: ["0,10"] }];
  const before = resolvedCells(normalizeFont(JSON.parse(JSON.stringify(old))), old.glyphs["Á"]).sort();
  const loaded = normalizeFont(old);
  assert.deepEqual(loaded.glyphs["Á"].components[1], { glyph: "´.case", dx: 3, dy: 1 });
  assert.deepEqual(resolvedCells(loaded, loaded.glyphs["Á"]).sort(), before);
  // An accent with an erased part stays as it was.
  assert.equal(loaded.glyphs["É"].components[1].glyph, "´");
});

test("¡ and ¿ hang from the x-height and go below the baseline", async () => {
  const { resolvedCells } = await import("../js/model.js");
  const font = normalizeFont(null);
  const { xHeight, capHeight } = font.metrics;
  // A "!" drawn as a stem up to the cap height and a dot on the baseline.
  font.glyphs["!"].cols = 1;
  font.glyphs["!"].cells = [...Array.from({ length: capHeight - 3 }, (_, r) => `0,${r + 3}`), "0,0"];
  const rows = resolvedCells(font, font.glyphs["¡"]).map((k) => +k.split(",")[1]);
  assert.equal(Math.max(...rows) + 1, xHeight, "the dot's top at the x-height");
  assert.equal(Math.min(...rows), xHeight - capHeight, "the stem below the baseline");
  assert.deepEqual(font.glyphs["¿"].components.map((c) => [c.glyph, c.turn, c.dy]), [["?", 180, xHeight - capHeight]]);
});

test("fonts saved before version 3 get hanging ¡ ¿, unless moved by hand", () => {
  const font = normalizeFont(null);
  const old = JSON.parse(JSON.stringify(font));
  old.version = 2;
  old.glyphs["¡"].components[0].dy = 0;
  old.glyphs["¿"].components[0].dy = 0;
  old.glyphs["¿"].components[0].dx = 1;
  const loaded = normalizeFont(old);
  assert.equal(loaded.version, 3);
  assert.equal(loaded.glyphs["¡"].components[0].dy, font.metrics.xHeight - font.metrics.capHeight);
  assert.equal(loaded.glyphs["¿"].components[0].dy, 0, "moved by hand: left as it was");
  // Once saved as version 3, a 0 chosen on purpose stays.
  loaded.glyphs["¡"].components[0].dy = 0;
  assert.equal(normalizeFont(JSON.parse(JSON.stringify(loaded))).glyphs["¡"].components[0].dy, 0);
});

test("new fonts use the square grid; older ones keep the circles they were drawn on", async () => {
  const { createBlankFont, migrateV1 } = await import("../js/model.js");
  assert.equal(normalizeFont(null).grid, "squares");
  assert.equal(createBlankFont().grid, "squares");
  assert.equal(createBlankFont({ grid: "circles" }).grid, "circles");
  // A saved font keeps its grid; one saved before grids existed was on circles.
  const saved = JSON.parse(JSON.stringify(normalizeFont(null)));
  saved.grid = "circles";
  assert.equal(normalizeFont(saved).grid, "circles");
  delete saved.grid;
  assert.equal(normalizeFont(saved).grid, "circles");
  assert.equal(migrateV1({ filled: [] }).grid, "circles");
});
