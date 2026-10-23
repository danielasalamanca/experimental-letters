import { test } from "node:test";
import assert from "node:assert/strict";
import { History, snapshot, fromSnapshot } from "../js/history.js";
import { normalizeFont } from "../js/model.js";

const plain = (font) => JSON.parse(JSON.stringify(font));

test("a snapshot gives back exactly the font it was taken from", () => {
  const font = normalizeFont(null);
  font.glyphs.a.cells.push("9,9");
  font.kerning.AV = -40;
  assert.deepEqual(fromSnapshot(snapshot(font)), plain(font));
});

test("undo and redo walk the history and come back", () => {
  const history = new History();
  let font = normalizeFont(null);
  const states = [];
  for (let i = 0; i < 3; i++) {
    history.push(font);
    states.push(plain(font));
    font.glyphs.a.cells.push(`${i},20`);
  }
  const last = plain(font);
  for (let i = 2; i >= 0; i--) {
    font = normalizeFont(history.undo(font));
    assert.deepEqual(plain(font), states[i]);
  }
  assert.equal(history.undo(font), null);
  assert.ok(!history.canUndo && history.canRedo);
  for (let i = 0; i < 3; i++) font = normalizeFont(history.redo(font));
  assert.deepEqual(plain(font), last);
  // A new change forgets what could be redone.
  history.undo(font);
  history.push(font);
  assert.ok(!history.canRedo);
});

test("the history keeps at most `limit` steps and can be cleared", () => {
  const history = new History(3);
  const font = normalizeFont(null);
  for (let i = 0; i < 5; i++) { font.glyphs.a.cols = 10 + i; history.push(font); }
  assert.equal(history.undoStack.length, 3);
  assert.equal(history.undo(font).glyphs.a.cols, 14);
  history.clear();
  assert.ok(!history.canUndo && !history.canRedo);
});

test("unchanged glyphs are shared with the previous step", () => {
  const font = normalizeFont(null);
  const first = snapshot(font);
  font.glyphs.b.cells.push("1,1");
  const second = snapshot(font, first);
  // Only the changed glyph has new JSON; the rest is the same string.
  const changed = Object.keys(second.glyphs).filter((k) => second.glyphs[k] !== first.glyphs[k]);
  assert.deepEqual(changed, ["b"]);
});
