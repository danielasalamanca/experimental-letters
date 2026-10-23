import { test } from "node:test";
import assert from "node:assert/strict";
import * as opentype from "../js/vendor/opentype.min.js";
import { buildOtf } from "../js/otf.js";
import {
  normalizeFont, kerningValue, setKerning, setKernGroup, setGroupKerning, kernGroup, kerningTarget,
  kerningPairs, groupMembers, removeKerning, layoutText, addAlternate,
} from "../js/model.js";

// A font with V and W in the left group "V", and A in the right group "A".
function grouped() {
  const font = normalizeFont(null);
  setKernGroup(font, "V", "left", "V");
  setKernGroup(font, "W", "left", "V");
  setKernGroup(font, "A", "right", "A");
  setGroupKerning(font, "A", "V", -60);
  return font;
}

test("a value between groups applies to every pair of their members", () => {
  const font = grouped();
  assert.equal(kerningValue(font, "A", "V"), -60);
  assert.equal(kerningValue(font, "A", "W"), -60);
  assert.equal(kerningValue(font, "V", "A"), 0, "the other order has its own groups");
  assert.equal(kerningTarget(font, "A", "W"), "group");
  assert.deepEqual(layoutText(font, "AW").items.map((it) => it.kern), [-60, 0]);
});

test("accented letters and alternates follow their letter's groups", () => {
  const font = grouped();
  const alt = addAlternate(font, "W");
  assert.equal(kernGroup(font, "Á", "right"), "A");
  assert.equal(kernGroup(font, alt, "left"), "V");
  assert.equal(kerningValue(font, "Á", "W"), -60);
  assert.equal(kerningValue(font, "Á", alt), -60);
  assert.deepEqual(groupMembers(font, "right", "A").filter((k) => /^[AÁ]$/.test(k)), ["A", "Á"]);
  // An accented letter can still have a group of its own.
  setKernGroup(font, "Á", "right", "Aacute");
  assert.equal(kerningValue(font, "Á", "W"), 0);
});

test("a pair of its own is an exception, even at 0", () => {
  const font = grouped();
  setKerning(font, "A", "W", -50);
  assert.equal(kerningValue(font, "A", "W"), -50);
  assert.equal(kerningValue(font, "A", "V"), -60);
  assert.equal(kerningTarget(font, "A", "W"), "pair");
  setKerning(font, "A", "W", 0);
  assert.equal(font.kerning.AW, 0, "kept to cancel the group");
  assert.equal(kerningValue(font, "A", "W"), 0);
  removeKerning(font, "A", "W");
  assert.equal(kerningValue(font, "A", "W"), -60);
  // Without groups, 0 just removes the pair.
  setKerning(font, "T", "o", 0);
  assert.ok(!("To" in font.kerning));
});

test("groups survive a save and reload, and group values of 0 are removed", () => {
  const font = grouped();
  const loaded = normalizeFont(JSON.parse(JSON.stringify(font)));
  assert.equal(kerningValue(loaded, "A", "W"), -60);
  setGroupKerning(loaded, "A", "V", 0);
  assert.deepEqual(loaded.groupKerning, {});
  assert.deepEqual(font.groupKerning, { A: { V: -60 } }, "the copy is independent");
});

test("the font files get the group values as pairs, with exceptions", async () => {
  const font = grouped();
  setKerning(font, "A", "W", -50);
  const pairs = new Map(kerningPairs(font).map(([l, r, v]) => [l + r, v]));
  assert.equal(pairs.get("AV"), -60);
  assert.equal(pairs.get("AW"), -50);
  assert.equal(pairs.get("ÁV"), -60);
  font.glyphs.A.cells = ["0,0", "1,1"];
  const otf = opentype.parse(await buildOtf(font));
  const k = (a, b) => otf.getKerningValue(otf.charToGlyph(a), otf.charToGlyph(b));
  // The exception is only for A: Á keeps the group value, like in Glyphs.
  assert.deepEqual([k("A", "V"), k("A", "W"), k("Á", "W"), k("V", "A")], [-60, -50, -60, 0]);
});
