import { test } from "node:test";
import assert from "node:assert/strict";
import * as opentype from "../js/vendor/opentype.min.js";
import { buildOtf } from "../js/otf.js";
import { autoKerner } from "../js/autokern.js";
import {
  normalizeFont, createGlyph, kerningValue, setKerning, setKernGroup, setGroupKerning, kerningPairs,
  layoutText, manualKerning,
} from "../js/model.js";

// A glyph drawn as one polygon, in cells (50 units; x-height 9, capitals 14).
const drawn = (points, extra = {}) => createGlyph({
  grid: "free", lsb: 50, rsb: 50, cols: Math.max(...points.map(([x]) => x)),
  outline: [{ closed: true, nodes: points.map(([x, y]) => ({ x, y, in: null, out: null })) }],
  ...extra,
});
const box = (w, h, extra) => drawn([[0, 0], [w, 0], [w, h], [0, h]], extra);
const round = (w, h) => drawn([[2, 0], [w - 2, 0], [w, 2], [w, h - 2], [w - 2, h], [2, h], [0, h - 2], [0, 2]]);
const tee = (arm) => drawn([[arm, 0], [arm + 2, 0], [arm + 2, 12], [2 * arm + 2, 12], [2 * arm + 2, 14], [0, 14], [0, 12], [arm, 12]]);

function sample(enabled = true) {
  const font = normalizeFont(null);
  for (const k of Object.keys(font.glyphs)) font.glyphs[k] = createGlyph({ cols: 4 });
  Object.assign(font.glyphs, {
    n: box(6, 9), o: round(7, 9), l: box(2, 14), H: box(8, 14), O: round(10, 14), I: box(2, 14),
    T: tee(4),
    A: drawn([[0, 0], [2, 0], [5, 12], [8, 0], [10, 0], [6, 14], [4, 14]]),
    V: drawn([[4, 0], [6, 0], [10, 14], [8, 14], [5, 2], [2, 14], [0, 14]]),
    ".": box(2, 2),
  });
  font.autoKern.enabled = enabled;
  return font;
}

test("automatic kerning is off until it is turned on", () => {
  const font = sample(false);
  assert.equal(kerningValue(font, "T", "o"), 0);
  assert.deepEqual(kerningPairs(font), []);
  assert.deepEqual(normalizeFont({ ...font, autoKern: undefined }).autoKern, { enabled: false, strength: 100 });
});

test("the control letters keep their sidebearings", () => {
  const font = sample();
  for (const pair of ["nn", "no", "on", "oo", "HH", "HO", "OH", "OO", "HI", "nl", "Hn"]) {
    assert.equal(kerningValue(font, ...pair), 0, pair);
  }
});

test("open pairs are tightened", () => {
  const font = sample();
  for (const pair of ["To", "Tn", "AV", "VA", "T.", "V."]) {
    const v = kerningValue(font, ...pair);
    assert.ok(v <= -30 && v >= -200, `${pair}: ${v}`);
    assert.ok(v % 5 === 0, `${pair}: ${v}`);
  }
  assert.ok(layoutText(font, "To").items[0].kern < 0);
});

test("the value follows the drawing and the intensity", () => {
  const font = sample();
  const wide = kerningValue(font, "T", "o");
  font.autoKern.strength = 50;
  assert.ok(kerningValue(font, "T", "o") > wide);
  font.autoKern.strength = 100;
  font.glyphs.T = tee(1);
  assert.ok(kerningValue(font, "T", "o") > wide, "shorter arms need less");
  font.glyphs.T = box(4, 14);
  assert.equal(kerningValue(font, "T", "o"), 0);
});

test("letters don't run into each other", () => {
  const font = sample();
  // The ascender of the l reaches the arm of the T: of the 100 units between
  // them, 40 stay free, however strong the kerning.
  font.autoKern.strength = 200;
  assert.equal(kerningValue(font, "T", "l"), -60);
  // Overhanging ink is pushed apart.
  font.glyphs.f = box(4, 14, { rsb: -80 });
  assert.ok(kerningValue(font, "f", "l") >= 50);
});

test("only pairs that happen in text, between drawn letters", () => {
  const font = sample();
  assert.equal(kerningValue(font, "o", "T"), 0, "lowercase before capital");
  assert.equal(kerningValue(font, "n", "V"), 0, "lowercase before capital");
  assert.equal(kerningValue(font, ".", "."), 0);
  assert.equal(kerningValue(font, "T", "e"), 0, "e isn't drawn");
  assert.equal(kerningValue(font, "T", " "), 0);
});

test("without control letters, pairs compare with the typical letter", () => {
  const font = sample();
  for (const k of ["n", "o", "H", "O"]) font.glyphs[k] = createGlyph({ cols: 4 });
  assert.equal(kerningValue(font, "I", "l"), 0);
  assert.ok(kerningValue(font, "A", "V") < 0);
});

test("a value set by hand wins over the automatic one, even 0", () => {
  const font = sample();
  setKerning(font, "T", "o", 0);
  assert.equal(font.kerning.To, 0);
  assert.equal(kerningValue(font, "T", "o"), 0);
  setKerning(font, "A", "V", -20);
  assert.equal(kerningValue(font, "A", "V"), -20);
  setKernGroup(font, "T", "right", "T");
  setKernGroup(font, ".", "left", "dot");
  assert.equal(manualKerning(font, "T", "."), undefined, "a group without a value is still automatic");
  assert.ok(kerningValue(font, "T", ".") < 0);
  setGroupKerning(font, "T", "dot", 0);
  assert.equal(kerningValue(font, "T", "."), 0);
});

test("the .otf holds the automatic pairs", async () => {
  const font = sample();
  setKerning(font, "A", "V", -20);
  const pairs = kerningPairs(font);
  const value = (l, r) => pairs.find((p) => p[0] === l && p[1] === r)?.[2];
  assert.equal(value("T", "o"), kerningValue(font, "T", "o"));
  assert.equal(value("A", "V"), -20);
  assert.equal(value("n", "n"), undefined);
  const otf = opentype.parse(await buildOtf(font));
  const index = (c) => otf.charToGlyphIndex(c);
  assert.equal(otf.getKerningValue(index("T"), index("o")), value("T", "o"));
});

test("a kerner measures a pair only once", () => {
  const kern = autoKerner(sample());
  assert.equal(kern("T", "o"), kern("T", "o"));
});
