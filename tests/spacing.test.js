import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFont, layoutText, setKerning, kerningValue, advanceWidth, missingAdvance } from "../js/model.js";

test("layout uses advance widths, sidebearings and kerning", () => {
  const font = normalizeFont(null);
  const a = advanceWidth(font, font.glyphs.A), v = advanceWidth(font, font.glyphs.V);
  let { items, width } = layoutText(font, "AVA");
  assert.deepEqual(items.map((i) => i.x), [0, a, a + v]);
  setKerning(font, "A", "V", -40);
  ({ items, width } = layoutText(font, "AVA"));
  assert.deepEqual(items.map((i) => i.x), [0, a - 40, a - 40 + v]);
  assert.equal(width, a - 40 + v + a);
});

test("kerning of 0 removes the pair", () => {
  const font = normalizeFont(null);
  setKerning(font, "T", "o", -30.4);
  assert.equal(kerningValue(font, "T", "o"), -30);
  setKerning(font, "T", "o", 0);
  assert.deepEqual(font.kerning, {});
});

test("lines and unknown characters", () => {
  const font = normalizeFont(null);
  const { items, lines } = layoutText(font, "a\n€a");
  assert.equal(lines, 2);
  assert.equal(items[1].line, 1);
  assert.equal(items[1].glyph, null);
  assert.equal(items[1].advance, missingAdvance(font));
  assert.equal(items[2].x, missingAdvance(font));
});

test("kerning survives a save and reload", () => {
  const font = normalizeFont(null);
  setKerning(font, "A", "V", -50);
  const again = normalizeFont(JSON.parse(JSON.stringify(font)));
  assert.equal(kerningValue(again, "A", "V"), -50);
  assert.equal(again.view.test.size, 72);
});
