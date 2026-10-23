import { test } from "node:test";
import assert from "node:assert/strict";
import { ORDER, nextToDraw } from "../js/guide.js";
import { normalizeFont, resolvedCells, resolvedOutline } from "../js/model.js";

const isEmpty = (font) => (g) => resolvedCells(font, g).length === 0 && resolvedOutline(font, g).length === 0;

test("the guide covers every letter and digit once, all in the character set", () => {
  const all = ORDER.flatMap((step) => step.chars);
  assert.equal(new Set(all).size, all.length, "no letter twice");
  const font = normalizeFont(null);
  for (const char of all) assert.ok(font.glyphs[char], `«${char}» is in the font`);
  for (const c of "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") assert.ok(all.includes(c), c);
});

test("control letters come first: n o, then H O and the straight capitals", () => {
  assert.deepEqual(ORDER[0].chars, ["n", "o"]);
  const caps = ORDER.flatMap((step) => step.chars).filter((c) => /[A-Z]/.test(c));
  assert.deepEqual(caps.slice(0, 7), ["H", "O", "I", "L", "F", "E", "T"]);
});

test("the suggested next letter is the first one not drawn yet", () => {
  const font = normalizeFont(null);
  font.glyphs.a.cells = []; // the sample "a" doesn't count
  assert.equal(nextToDraw(font, isEmpty(font)), "n");
  font.glyphs.n.cells = ["0,0"];
  assert.equal(nextToDraw(font, isEmpty(font)), "o");
  for (const step of ORDER) for (const c of step.chars) font.glyphs[c].cells = ["0,0"];
  assert.equal(nextToDraw(font, isEmpty(font)), null);
});
