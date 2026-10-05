import { test } from "node:test";
import assert from "node:assert/strict";
import { openLibrary, saveFont, loadFont, deleteFont, fontName, newId } from "../js/library.js";
import { normalizeFont, createBlankFont } from "../js/model.js";

const memory = (initial = {}) => {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test("a project from the single-font version becomes the first font", () => {
  const old = normalizeFont(null);
  old.meta.family = "Mi Grilla";
  const storage = memory({ "experimental-letters:v2": JSON.stringify(old) });
  const { index, data } = openLibrary(storage);
  assert.equal(data.meta.family, "Mi Grilla");
  assert.ok(saveFont(storage, index, normalizeFont(data)));
  const again = openLibrary(storage);
  assert.equal(again.index.fonts.length, 1);
  assert.equal(again.index.fonts[0].name, "Mi Grilla Regular");
  assert.equal(again.data.meta.family, "Mi Grilla");
});

test("several fonts are kept separately and the open one is remembered", () => {
  const storage = memory();
  const { index } = openLibrary(storage);
  const first = createBlankFont({ family: "Uno" });
  saveFont(storage, index, first);
  const firstId = index.active;
  index.active = newId();
  const second = createBlankFont({ family: "Dos", grid: "squares" });
  second.glyphs.a.cells = ["0,0"];
  saveFont(storage, index, second);

  assert.equal(index.fonts.length, 2);
  assert.equal(loadFont(storage, firstId).meta.family, "Uno");
  const reopened = openLibrary(storage);
  assert.equal(reopened.data.meta.family, "Dos");
  assert.equal(reopened.data.grid, "squares");
  assert.deepEqual(reopened.data.glyphs.a.cells, ["0,0"]);
});

test("deleting a font removes it and its data", () => {
  const storage = memory();
  const { index } = openLibrary(storage);
  saveFont(storage, index, createBlankFont({ family: "Borrar" }));
  const id = index.active;
  deleteFont(storage, index, id);
  assert.equal(index.fonts.length, 0);
  assert.equal(loadFont(storage, id), null);
});

test("a full browser storage is reported, not thrown", () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => {} };
  const { index } = openLibrary(storage);
  assert.equal(saveFont(storage, index, createBlankFont()), false);
});

test("blank fonts have no drawing and a name", () => {
  const font = createBlankFont({ family: "Nueva", grid: "squares" });
  assert.equal(font.glyphs.a.cells.length, 0);
  assert.equal(font.grid, "squares");
  assert.equal(fontName(font), "Nueva Regular");
  assert.ok(font.glyphs["á"].components.length === 2);
});
