// Font export: builds an OpenType (CFF) font with opentype.js, then adds a
// GPOS table with the kerning pairs, which opentype.js cannot write.

import { glyphFinalContours } from "./shapes.js";
import { CHARSET, glyphName } from "./charset.js";
import { advanceWidth } from "./model.js";
import { atWeight, normalizeAxis, weightName } from "./masters.js";

const loadOpentype = () => import("./vendor/opentype.min.js");

// mode: "join" = with the minimum join (as on the canvas), "raw" = as is.
// weight: a weight between the two masters (see masters.js); the Regular
// master when left out.
export async function buildOtf(font, { mode = "join", weight = null } = {}) {
  const opentype = await loadOpentype();
  const cu = font.cell;
  const meta = font.meta;
  const axis = normalizeAxis(font.axis);
  const instance = weight !== null && weight !== axis.min;

  const glyphs = [new opentype.Glyph({ name: ".notdef", advanceWidth: Math.round(font.upm / 2), path: new opentype.Path() })];
  const chars = [...new Set([...CHARSET, ...Object.keys(font.glyphs)])].filter((c) => font.glyphs[c]);
  for (const char of chars) {
    const g = font.glyphs[char];
    const at = instance ? atWeight(font, char, weight) : null;
    glyphs.push(new opentype.Glyph({
      name: glyphName(char),
      unicode: char.codePointAt(0),
      advanceWidth: Math.round(at ? at.advance : advanceWidth(font, g)),
      path: at ? contoursPath(opentype, at.contours, at.lsb, cu) : glyphPath(opentype, font, g, mode),
    }));
  }

  const otf = new opentype.Font({
    familyName: meta.family.trim() || "Letras Experimentales",
    styleName: instance ? weightName(weight) : meta.style.trim() || "Regular",
    weightClass: instance ? weight : axis.min,
    designer: meta.designer.trim() || undefined,
    version: `Version ${meta.version.trim() || "1.000"}`,
    unitsPerEm: font.upm,
    ascender: font.metrics.ascender * cu,
    descender: font.metrics.descender * cu,
    glyphs,
  });

  const index = new Map(chars.map((c, i) => [c, i + 1]));
  const pairs = Object.entries(font.kerning)
    .map(([pair, value]) => {
      const [left, right] = [...pair];
      return [index.get(left), index.get(right), Math.round(value)];
    })
    .filter(([l, r, v]) => l && r && v);

  const buffer = otf.toArrayBuffer();
  return pairs.length ? addTable(buffer, "GPOS", gposKerning(pairs)) : buffer;
}

// The glyph's ink as closed contours, in font units (origin at the left
// sidebearing). Only the columns visible on the canvas are exported.
export function glyphPath(opentype, font, glyph, mode) {
  return contoursPath(opentype, glyphFinalContours(font, glyph, { mode }), glyph.lsb, font.cell);
}

// Contours in cells as an opentype.js path in units, `lsb` units from the origin.
function contoursPath(opentype, contours, lsb, cu) {
  const path = new opentype.Path();
  const X = (x) => Math.round(lsb + x * cu);
  const Y = (y) => Math.round(y * cu);
  for (const contour of contours) {
    let last = null;
    for (const c of contour) {
      if (c.type === "M") { path.moveTo(X(c.x), Y(c.y)); last = [X(c.x), Y(c.y)]; }
      else if (c.type === "L") {
        const p = [X(c.x), Y(c.y)];
        if (p[0] !== last[0] || p[1] !== last[1]) path.lineTo(...p);
        last = p;
      } else if (c.type === "C") {
        path.curveTo(X(c.x1), Y(c.y1), X(c.x2), Y(c.y2), X(c.x), Y(c.y));
        last = [X(c.x), Y(c.y)];
      } else path.close();
    }
  }
  return path;
}

// --- GPOS: one pair-adjustment lookup (format 1) under the "kern" feature,
// for the DFLT and latn scripts. pairs: [[leftGlyph, rightGlyph, xAdvance]].
export function gposKerning(pairs) {
  const byFirst = new Map();
  for (const [l, r, v] of pairs) {
    if (!byFirst.has(l)) byFirst.set(l, new Map());
    byFirst.get(l).set(r, v);
  }
  const firsts = [...byFirst.keys()].sort((a, b) => a - b);

  const w = new Writer();
  // Header
  w.u32(0x00010000); w.u16(10); w.u16(36); w.u16(50);
  // ScriptList (offset 10): DFLT and latn share one Script table.
  w.u16(2);
  w.tag("DFLT"); w.u16(14);
  w.tag("latn"); w.u16(14);
  w.u16(4); w.u16(0);                 // Script: default LangSys at +4, no others
  w.u16(0); w.u16(0xffff); w.u16(1); w.u16(0); // LangSys: feature 0
  // FeatureList (offset 36)
  w.u16(1); w.tag("kern"); w.u16(8);
  w.u16(0); w.u16(1); w.u16(0);       // Feature: lookup 0
  // LookupList (offset 50)
  w.u16(1); w.u16(4);
  w.u16(2); w.u16(0); w.u16(1); w.u16(8); // Lookup: type 2 (pair), 1 subtable at +8
  // PairPosFormat1 (offset 50 + 12 = 62)
  const pairPos = w.length;
  const headerSize = 10 + 2 * firsts.length;
  const setSizes = firsts.map((f) => 2 + 4 * byFirst.get(f).size);
  const coverageOffset = headerSize + setSizes.reduce((a, b) => a + b, 0);
  w.u16(1); w.u16(coverageOffset); w.u16(0x0004); w.u16(0); w.u16(firsts.length);
  let offset = headerSize;
  setSizes.forEach((size) => { w.u16(offset); offset += size; });
  for (const f of firsts) {
    const seconds = [...byFirst.get(f)].sort((a, b) => a[0] - b[0]);
    w.u16(seconds.length);
    for (const [r, v] of seconds) { w.u16(r); w.i16(v); }
  }
  // Coverage format 1
  w.u16(1); w.u16(firsts.length);
  firsts.forEach((f) => w.u16(f));
  if (w.length - pairPos > 0xffff) throw new Error("Demasiados pares de kerning.");
  return w.bytes();
}

export class Writer {
  constructor() { this.data = []; }
  get length() { return this.data.length; }
  u16(v) { this.data.push((v >> 8) & 0xff, v & 0xff); }
  i16(v) { this.u16(v < 0 ? v + 0x10000 : v); }
  u32(v) { this.u16((v >>> 16) & 0xffff); this.u16(v & 0xffff); }
  tag(t) { for (const ch of t) this.data.push(ch.charCodeAt(0)); }
  i8(v) { this.data.push(v < 0 ? v + 0x100 : v); }
  u8(v) { this.data.push(v & 0xff); }
  fixed(v) { this.u32(Math.round(v * 65536) >>> 0); }
  bytesOf(arr) { for (const b of arr) this.data.push(b); }
  pad(n = 4) { while (this.data.length % n) this.data.push(0); }
  bytes() { return new Uint8Array(this.data); }
}

// Adds (or replaces) a table in an sfnt font, rebuilding the table
// directory, checksums and head.checkSumAdjustment.
export function addTable(buffer, tag, data) {
  const { flavor, tables } = readSfnt(buffer);
  tables.set(tag, data);
  return writeSfnt(flavor, tables);
}

// The tables of an sfnt font: { flavor, tables: Map(tag -> bytes) }.
export function readSfnt(buffer) {
  const view = new DataView(buffer);
  const count = view.getUint16(4);
  const tables = new Map();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(...new Uint8Array(buffer, at, 4));
    const offset = view.getUint32(at + 8), length = view.getUint32(at + 12);
    tables.set(tag, new Uint8Array(buffer, offset, length).slice());
  }
  return { flavor: view.getUint32(0), tables };
}

// An sfnt font from its tables (Map tag -> bytes), with checksums and
// head.checkSumAdjustment.
export function writeSfnt(flavor, tableMap) {
  const tables = [...tableMap].map(([tag, data]) => ({ tag, data })).sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const n = tables.length;
  const pad = (len) => (len + 3) & ~3;
  let size = 12 + 16 * n;
  for (const t of tables) size += pad(t.data.length);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  const selector = Math.floor(Math.log2(n));
  dv.setUint32(0, flavor);
  dv.setUint16(4, n);
  dv.setUint16(6, 2 ** selector * 16);
  dv.setUint16(8, selector);
  dv.setUint16(10, n * 16 - 2 ** selector * 16);

  let offset = 12 + 16 * n;
  let headOffset = -1;
  tables.forEach((t, i) => {
    if (t.tag === "head") { t.data = t.data.slice(); new DataView(t.data.buffer).setUint32(8, 0); headOffset = offset; }
    out.set(t.data, offset);
    const at = 12 + i * 16;
    for (let j = 0; j < 4; j++) out[at + j] = t.tag.charCodeAt(j);
    dv.setUint32(at + 4, checksum(out, offset, pad(t.data.length)));
    dv.setUint32(at + 8, offset);
    dv.setUint32(at + 12, t.data.length);
    offset += pad(t.data.length);
  });
  if (headOffset >= 0) dv.setUint32(headOffset + 8, (0xb1b0afba - checksum(out, 0, size)) >>> 0);
  return out.buffer;
}

function checksum(bytes, start, length) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  let sum = 0;
  for (let i = start; i < start + length; i += 4) sum = (sum + dv.getUint32(i)) >>> 0;
  return sum;
}
