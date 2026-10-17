import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createFullFont, normalizeFont, resolvedCells, resolvedOutline, alternates, allChars, addAlternate, removeAlternate,
} from "../js/model.js";
import { pureComposite } from "../js/masters.js";
import { componentContours } from "../js/shapes.js";
import { glyphName, alternateOf, baseChar, isCapital, codepoint } from "../js/charset.js";
import { windingAt } from "../js/geometry.js";
import { buildOtf } from "../js/otf.js";

const square = (x0, y0, x1, y1) => ({ closed: true, nodes: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => ({ x, y, in: null, out: null })) });

test("each accented letter places its accent on its own", () => {
  const font = createFullFont();
  font.glyphs["´"].cells = ["1,10", "2,11"];
  font.glyphs["í"].components[1].dy = 2;
  assert.equal(font.glyphs["á"].components[1].dy, 0);
  assert.ok(resolvedCells(font, font.glyphs["í"]).includes(`${1 + font.glyphs["í"].components[1].dx},12`));
});

test("a composite can erase cells of a component without changing it", () => {
  const font = createFullFont();
  font.glyphs.i.cells = ["1,0", "1,1", "1,2", "1,8"];
  const ii = font.glyphs["í"];
  ii.components[0].erase = ["1,8"];
  assert.ok(!resolvedCells(font, ii).includes("1,8"), "el punto sigue ahí");
  assert.ok(font.glyphs.i.cells.includes("1,8"));
  // The erased cell moves with the component.
  ii.components[0].dx = 2;
  assert.ok(!resolvedCells(font, ii).includes("3,8") && resolvedCells(font, ii).includes("3,0"));
  // It survives saving, and the letter gets a bold master of its own.
  const again = normalizeFont(JSON.parse(JSON.stringify(font)));
  assert.deepEqual(again.glyphs["í"].components[0].erase, ["1,8"]);
  assert.equal(pureComposite(ii), false);
  assert.equal(pureComposite(font.glyphs["á"]), true);
});

test("a composite can hide a part of a component drawn with nodes (the dot of the i)", () => {
  const font = createFullFont();
  font.glyphs.i.outline = [square(1, 0, 2, 7), square(1, 8, 2, 9)];
  const ii = font.glyphs["í"];
  ii.components[0].dx = 1;
  ii.components[0].hide = [[1.5, 8.5]];
  const out = resolvedOutline(font, ii);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].nodes.map((n) => [n.x, n.y])[0], [2, 0]);
  assert.equal(font.glyphs.i.outline.length, 2);
  // The canvas picks the component by its ink, where it is placed.
  const contours = componentContours(font, ii, 0);
  assert.notEqual(windingAt(contours, [2.5, 3]), 0);
  assert.equal(windingAt(contours, [2.5, 8.5]), 0);
});

test("alternates: named, listed after the set, copies of their letter", () => {
  const font = createFullFont();
  font.glyphs.a.cells = ["0,0", "1,1"];
  const k = addAlternate(font, "a");
  assert.equal(k, "a.alt1");
  assert.deepEqual(font.glyphs[k].cells, ["0,0", "1,1"]);
  font.glyphs[k].cells.push("2,2");
  assert.equal(font.glyphs.a.cells.length, 2);
  // An alternate of an alternate is another alternate of the letter.
  assert.equal(addAlternate(font, k), "a.alt2");
  assert.deepEqual(alternates(font, "a"), ["a.alt1", "a.alt2"]);
  assert.deepEqual(allChars(font).slice(-2), ["a.alt1", "a.alt2"]);
  assert.equal(glyphName("á.alt1"), "aacute.alt1");
  assert.deepEqual(alternateOf("..alt3"), { base: ".", n: 3 });
  assert.equal(baseChar("A.alt1"), "A");
  assert.ok(isCapital("A.alt1") && !isCapital("a.alt1"));
  assert.equal(codepoint("a.alt1"), "U+0061");
  font.glyphs["á"].components[0].glyph = "a.alt2";
  removeAlternate(font, "a.alt2");
  assert.deepEqual(alternates(font, "a"), ["a.alt1"]);
  assert.equal(font.glyphs["á"].components.length, 1);
  // Kept on save.
  assert.deepEqual(alternates(normalizeFont(JSON.parse(JSON.stringify(font))), "a"), ["a.alt1"]);
});

test("the .otf offers alternates through aalt, salt and ssNN, without a code point", async () => {
  const font = createFullFont();
  font.glyphs.a.cells = ["0,0"];
  font.glyphs.g.cells = ["0,0"];
  addAlternate(font, "a");
  addAlternate(font, "a");
  addAlternate(font, "g");
  const opentype = await import("../js/vendor/opentype.min.js");
  const parsed = (opentype.default ?? opentype).parse(await buildOtf(font));
  const byName = (n) => { for (let i = 0; i < parsed.glyphs.length; i++) if (parsed.glyphs.get(i).name === n) return i; return -1; };
  const [a, a1, a2, g, g1] = ["a", "a.alt1", "a.alt2", "g", "g.alt1"].map(byName);
  assert.ok(a1 > 0 && a2 > 0 && g1 > 0);
  assert.equal(parsed.glyphs.get(a1).unicode, undefined);
  const gsub = parsed.tables.gsub;
  assert.deepEqual(gsub.features.map((f) => f.tag), ["aalt", "salt", "ss01", "ss02"]);
  const [aalt, ss01, ss02] = gsub.lookups.map((l) => l.subtables[0]);
  assert.deepEqual(aalt.coverage.glyphs, [a, g]);
  assert.deepEqual(aalt.alternateSets, [[a1, a2], [g1]]);
  assert.deepEqual(ss01.coverage.glyphs, [a, g]);
  assert.deepEqual(ss01.substitute, [a1, g1]);
  assert.deepEqual(ss02.coverage.glyphs, [a]);
  assert.deepEqual(ss02.substitute, [a2]);
});
