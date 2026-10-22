import { test } from "node:test";
import assert from "node:assert/strict";
import * as opentype from "../js/vendor/opentype.min.js";
import { buildOtf } from "../js/otf.js";
import { buildVariableTtf } from "../js/variable.js";
import { normalizeFont, setKerning, layoutText, capitalOf, exportChars, addAlternate } from "../js/model.js";

function capsFont() {
  const font = normalizeFont(null);
  font.glyphs.A.cells = ["0,0", "0,1", "1,2", "2,1", "2,0", "1,1"];
  font.glyphs.V.cells = ["0,2", "1,1", "1,0", "2,2"];
  font.glyphs.a.cells = ["0,0"];
  setKerning(font, "A", "V", -60);
  font.allCaps = true;
  return font;
}

test("an all-caps font sets lowercase letters as capitals, with their kerning", () => {
  const font = capsFont();
  assert.equal(capitalOf(font, "a"), "A");
  assert.equal(capitalOf(font, "ñ"), "Ñ");
  assert.equal(capitalOf(font, "A"), null);
  assert.equal(capitalOf(font, "1"), null);
  const items = layoutText(font, "av").items;
  assert.deepEqual(items.map((it) => it.char), ["A", "V"]);
  assert.equal(items[0].glyph, font.glyphs.A);
  assert.equal(items[0].kern, -60);
  font.allCaps = false;
  assert.equal(capitalOf(font, "a"), null);
  assert.equal(layoutText(font, "a").items[0].glyph, font.glyphs.a);
});

test("lowercase glyphs and their alternates aren't exported in an all-caps font", () => {
  const font = capsFont();
  const alt = addAlternate(font, "a");
  const chars = exportChars(font);
  assert.ok(chars.includes("A") && chars.includes("Ñ") && chars.includes("1"));
  assert.ok(!chars.includes("a") && !chars.includes("ñ") && !chars.includes(alt));
});

test("the .otf maps lowercase code points to the capitals", async () => {
  const otf = opentype.parse(await buildOtf(capsFont()));
  assert.equal(otf.charToGlyph("a").name, "A");
  assert.equal(otf.charToGlyph("ñ").name, "Ntilde");
  assert.equal(otf.charToGlyph("á").name, "Aacute");
  assert.ok(!Array.from({ length: otf.glyphs.length }, (_, i) => otf.glyphs.get(i).name).includes("a"));
  const [A, V] = [otf.charToGlyph("a"), otf.charToGlyph("v")];
  assert.equal(otf.getKerningValue(A, V), -60);
});

test("the variable font maps lowercase code points to the capitals", async () => {
  const otf = opentype.parse(await buildVariableTtf(capsFont()));
  // TrueType fonts here carry no glyph names: compare indices.
  const A = otf.charToGlyph("A").index;
  assert.ok(A > 0);
  assert.equal(otf.charToGlyph("a").index, A);
});
