import { test } from "node:test";
import assert from "node:assert/strict";
import * as opentype from "../js/vendor/opentype.min.js";
import { buildOtf, readSfnt } from "../js/otf.js";
import { buildVariableTtf } from "../js/variable.js";
import { sfntToWoff } from "../js/woff.js";
import { normalizeFont, setKerning } from "../js/model.js";

function sampleFont() {
  const font = normalizeFont(null);
  font.meta.family = "Prueba Web";
  font.glyphs.A.cells = ["0,0", "0,1", "1,2", "2,1", "2,0", "1,1"];
  font.glyphs.V.cells = ["0,2", "1,1", "1,0", "2,2"];
  setKerning(font, "A", "V", -60);
  return font;
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The tables of a WOFF file, uncompressed, by tag, checking the header.
async function readWoff(buffer) {
  const dv = new DataView(buffer);
  assert.equal(dv.getUint32(0), 0x774f4646, "firma wOFF");
  assert.equal(dv.getUint32(8), buffer.byteLength, "largo total");
  const tables = new Map();
  for (let i = 0; i < dv.getUint16(12); i++) {
    const at = 44 + i * 20;
    const tag = String.fromCharCode(...new Uint8Array(buffer, at, 4));
    const offset = dv.getUint32(at + 4), comp = dv.getUint32(at + 8), orig = dv.getUint32(at + 12);
    assert.equal(offset % 4, 0, `${tag} alineada`);
    const raw = new Uint8Array(buffer, offset, comp);
    tables.set(tag, comp < orig ? await inflate(raw) : raw.slice());
  }
  return tables;
}

test("the .woff holds exactly the tables of the .otf, compressed", async () => {
  const otf = await buildOtf(sampleFont());
  const woff = await sfntToWoff(otf);
  assert.ok(woff.byteLength < otf.byteLength, "más liviana");
  const original = readSfnt(otf).tables;
  const tables = await readWoff(woff);
  assert.deepEqual([...tables.keys()].sort(), [...original.keys()].sort());
  for (const [tag, data] of original) assert.deepEqual(tables.get(tag), data, tag);
  assert.equal(new DataView(woff).getUint32(4), 0x4f54544f); // "OTTO": CFF outlines
});

test("opentype.js reads the .woff like the .otf", async () => {
  const font = opentype.parse(await sfntToWoff(await buildOtf(sampleFont())));
  assert.equal(font.names.windows.fontFamily.en, "Prueba Web");
  assert.equal(font.getKerningValue(font.charToGlyph("A"), font.charToGlyph("V")), -60);
  assert.ok(font.charToGlyph("A").path.commands.length > 10);
});

test("the variable font also exports as .woff", async () => {
  const ttf = await buildVariableTtf(sampleFont());
  const woff = await sfntToWoff(ttf);
  assert.equal(new DataView(woff).getUint32(4), 0x00010000); // TrueType outlines
  const tables = await readWoff(woff);
  for (const [tag, data] of readSfnt(ttf).tables) assert.deepEqual(tables.get(tag), data, tag);
  assert.ok(tables.has("fvar") && tables.has("gvar"));
});
