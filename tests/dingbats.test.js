import { test } from "node:test";
import assert from "node:assert/strict";
import * as opentype from "../js/vendor/opentype.min.js";
import { buildOtf } from "../js/otf.js";
import { normalizeFont, addDingbat, removeDingbat, dingbats, addAlternate, allChars, exportChars, setKerning, charUnicodes } from "../js/model.js";
import { glyphName, codepoint, isDingbat, parseDingbat, DINGBATS, CHARSET } from "../js/charset.js";

test("a new font has no dingbats: they are optional", () => {
  const font = normalizeFont(null);
  assert.deepEqual(dingbats(font), []);
  assert.ok(!exportChars(font).some(isDingbat));
});

test("the catalogue has no repeats and nothing from the character set", () => {
  assert.equal(new Set(DINGBATS).size, DINGBATS.length);
  assert.ok(DINGBATS.every((c) => !CHARSET.includes(c) && c.codePointAt(0) > 0x7f && c.codePointAt(0) <= 0xffff));
});

test("dingbats get real code points and uniXXXX names", () => {
  assert.equal(glyphName("★"), "uni2605");
  assert.equal(codepoint("★"), "U+2605");
  assert.equal(glyphName("a"), "a");
  assert.equal(glyphName("ñ"), "ntilde");
});

test("parseDingbat accepts a character or a code, and refuses the font's own characters", () => {
  assert.equal(parseDingbat("✺"), "✺");
  assert.equal(parseDingbat("U+273A"), "✺");
  assert.equal(parseDingbat("u273a"), "✺");
  assert.equal(parseDingbat("273A"), "✺");
  for (const bad of ["", "a", "A", "ñ", "0041", "1F600", "xyz", "ab", "U+0020"]) assert.equal(parseDingbat(bad), null, bad);
});

test("adding a dingbat keeps the list by code point, after the character set", () => {
  const font = normalizeFont(null);
  assert.ok(addDingbat(font, "✂"));
  assert.ok(addDingbat(font, "★"));
  assert.ok(!addDingbat(font, "★"));
  assert.deepEqual(dingbats(font), ["★", "✂"]);
  const alt = addAlternate(font, "✂");
  const keys = allChars(font);
  assert.deepEqual(keys.slice(-3), ["★", "✂", alt]);
  assert.ok(isDingbat("✂") && !isDingbat(alt) && !isDingbat("a"));
});

test("dingbats survive normalizing a saved font", () => {
  const font = normalizeFont(null);
  addDingbat(font, "➔");
  font.glyphs["➔"].cells = ["0,0", "1,0"];
  const again = normalizeFont(JSON.parse(JSON.stringify(font)));
  assert.deepEqual(dingbats(again), ["➔"]);
  assert.deepEqual(again.glyphs["➔"].cells, ["0,0", "1,0"]);
});

test("removing a dingbat removes its alternates, components and kerning", () => {
  const font = normalizeFont(null);
  addDingbat(font, "★");
  const alt = addAlternate(font, "★");
  font.glyphs.a.components.push({ glyph: "★", dx: 0, dy: 0 });
  setKerning(font, "★", "a", -20);
  removeDingbat(font, "★");
  assert.ok(!font.glyphs["★"] && !font.glyphs[alt]);
  assert.ok(!font.glyphs.a.components.some((c) => c.glyph === "★"));
  assert.deepEqual(Object.keys(font.kerning).filter((k) => k.includes("★")), []);
  removeDingbat(font, "a"); // not a dingbat: untouched
  assert.ok(font.glyphs.a);
});

test("the exported .otf carries the dingbats on their Unicode code points", async () => {
  const font = normalizeFont(null);
  addDingbat(font, "★");
  font.glyphs["★"].cells = ["0,0", "1,0", "0,1", "1,1"];
  font.glyphs.a.cells = ["0,0"];
  assert.deepEqual(charUnicodes(font, "★"), [0x2605]);
  const parsed = opentype.parse(await buildOtf(font));
  const g = parsed.charToGlyph("★");
  assert.equal(g.name, "uni2605");
  assert.ok(g.unicode === 0x2605 && g.path.commands.length > 0);
});
