// Variable font export (.ttf): TrueType outlines for the Regular master
// (glyf) plus the difference to the bold master for every point (gvar),
// along a weight axis (fvar) with named weights in between (Medium, Bold…).
//
// opentype.js writes the tables that don't change with the outlines (cmap,
// OS/2, hhea, post…); the rest is written here. Both masters are turned into
// quadratic curves the same way, so they keep the same points.

import { CHARSET, glyphName } from "./charset.js";
import { masterPair, normalizeAxis, instances } from "./masters.js";
import { gposKerning, readSfnt, writeSfnt, Writer } from "./otf.js";

const loadOpentype = () => import("./vendor/opentype.min.js");

export async function buildVariableTtf(font) {
  const opentype = await loadOpentype();
  const cu = font.cell;
  const axis = normalizeAxis(font.axis);
  const meta = font.meta;
  const family = meta.family.trim() || "Letras Experimentales";
  const chars = [...new Set([...CHARSET, ...Object.keys(font.glyphs)])].filter((c) => font.glyphs[c]);

  // Both masters of every glyph, as TrueType points (font units).
  const notdef = { name: ".notdef", unicode: null, regular: emptyGlyph(), bold: emptyGlyph(), advance: [font.upm / 2, font.upm / 2] };
  const glyphs = [notdef];
  for (const char of chars) {
    const pair = masterPair(font, char);
    const ok = pair.status === "ok";
    const units = (contours, lsb) => contours.map((cmds) => cmds.map((c) => {
      if (c.type === "Z") return c;
      const q = { type: c.type, x: lsb + c.x * cu, y: c.y * cu };
      if (c.type === "C") Object.assign(q, { x1: lsb + c.x1 * cu, y1: c.y1 * cu, x2: lsb + c.x2 * cu, y2: c.y2 * cu });
      return q;
    }));
    const reg = units(pair.regular, pair.lsb[0]);
    const bold = ok ? units(pair.bold, pair.lsb[1]) : reg;
    const [regular, boldPts] = toQuadratic(reg, bold);
    glyphs.push({
      name: glyphName(char), unicode: char.codePointAt(0), regular, bold: boldPts,
      advance: [pair.advance[0], ok ? pair.advance[1] : pair.advance[0]].map(Math.round),
    });
  }

  // The tables that opentype.js writes well, from a font with the same glyph
  // order (its CFF outlines are thrown away).
  const otf = new opentype.Font({
    familyName: family,
    styleName: "Regular",
    designer: meta.designer.trim() || undefined,
    version: `Version ${meta.version.trim() || "1.000"}`,
    unitsPerEm: font.upm,
    ascender: font.metrics.ascender * cu,
    descender: font.metrics.descender * cu,
    weightClass: axis.min,
    glyphs: glyphs.map((g) => new opentype.Glyph({
      name: g.name, unicode: g.unicode ?? undefined, advanceWidth: g.advance[0], path: new opentype.Path(),
    })),
  });
  const { tables } = readSfnt(otf.toArrayBuffer());
  tables.delete("CFF ");

  const { glyf, loca, bbox, maxPoints, maxContours } = buildGlyf(glyphs);
  tables.set("glyf", glyf);
  tables.set("loca", loca);
  tables.set("gvar", buildGvar(glyphs));
  tables.set("hmtx", buildHmtx(glyphs));
  tables.set("maxp", buildMaxp(glyphs.length, maxPoints, maxContours));
  tables.set("head", patchHead(tables.get("head"), bbox));
  tables.set("hhea", patchHhea(tables.get("hhea"), glyphs));
  tables.set("OS/2", patchOs2(tables.get("OS/2"), axis.min));
  tables.set("post", patchPost(tables.get("post")));

  const named = instances(axis);
  const names = nameRecords({ family, meta, named });
  tables.set("name", buildName(names.records));
  tables.set("fvar", buildFvar(axis, named, names));
  tables.set("STAT", buildStat(axis, named, names));

  const index = new Map(chars.map((c, i) => [c, i + 1]));
  const pairs = Object.entries(font.kerning)
    .map(([pair, value]) => {
      const [left, right] = [...pair];
      return [index.get(left), index.get(right), Math.round(value)];
    })
    .filter(([l, r, v]) => l && r && v);
  if (pairs.length) tables.set("GPOS", gposKerning(pairs));
  return writeSfnt(0x00010000, tables);
}

const emptyGlyph = () => ({ contours: [] });

// --- Cubic to quadratic, the same way for both masters ---
// A cubic becomes k quadratic pieces; k is chosen so that both masters stay
// within half a unit, and is the same for both, so they keep the same points.

function cubicSplit(p0, p1, p2, p3, a, b) {
  // The part of the cubic between t = a and t = b.
  const at = (t) => {
    const u = 1 - t;
    return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
  };
  const d = (t) => {
    const u = 1 - t;
    return [0, 1].map((k) => 3 * (u * u * (p1[k] - p0[k]) + 2 * u * t * (p2[k] - p1[k]) + t * t * (p3[k] - p2[k])));
  };
  const s = (b - a) / 3;
  const q0 = at(a), q3 = at(b), da = d(a), db = d(b);
  return [q0, [q0[0] + da[0] * s, q0[1] + da[1] * s], [q3[0] - db[0] * s, q3[1] - db[1] * s], q3];
}

// The quadratic control point that best stands for a cubic piece, and how far
// off it can be.
function quadFor([p0, p1, p2, p3]) {
  const c = [0, 1].map((k) => (3 * (p1[k] + p2[k]) - p0[k] - p3[k]) / 4);
  const err = (Math.sqrt(3) / 36) * Math.hypot(p3[0] - 3 * p2[0] + 3 * p1[0] - p0[0], p3[1] - 3 * p2[1] + 3 * p1[1] - p0[1]);
  return { c, err };
}

function piecesNeeded(cubics) {
  for (let k = 1; k < 16; k++) {
    const fine = cubics.every((cub) => {
      for (let i = 0; i < k; i++) if (quadFor(cubicSplit(...cub, i / k, (i + 1) / k)).err > 0.5) return false;
      return true;
    });
    if (fine) return k;
  }
  return 16;
}

// Both masters' contours (commands, units) as TrueType contours:
// [{ points: [{ x, y, on }] }], with exactly the same points in both.
export function toQuadratic(a, b) {
  const out = [[], []];
  a.forEach((cmdsA, ci) => {
    const cmdsB = b[ci];
    const lists = [[], []];
    let prev = [null, null];
    const real = cmdsA.filter((c) => c.type !== "Z");
    const realB = cmdsB.filter((c) => c.type !== "Z");
    const start = real[0];
    real.forEach((cA, i) => {
      const cB = realB[i];
      // A curve that closes the contour ends on its first point.
      const closing = i === real.length - 1 && i > 0 && Math.hypot(cA.x - start.x, cA.y - start.y) < 1e-6;
      if (cA.type === "M" || cA.type === "L") {
        [cA, cB].forEach((c, m) => { lists[m].push({ x: c.x, y: c.y, on: true }); prev[m] = [c.x, c.y]; });
        return;
      }
      const cubics = [cA, cB].map((c, m) => [prev[m], [c.x1, c.y1], [c.x2, c.y2], [c.x, c.y]]);
      const k = piecesNeeded(cubics);
      cubics.forEach((cub, m) => {
        for (let p = 0; p < k; p++) {
          const piece = cubicSplit(...cub, p / k, (p + 1) / k);
          const { c } = quadFor(piece);
          lists[m].push({ x: c[0], y: c[1], on: false });
          // A closing curve ends on the first point, which is already there.
          if (!(closing && p === k - 1)) lists[m].push({ x: piece[3][0], y: piece[3][1], on: true });
        }
        prev[m] = cub[3];
      });
    });
    // TrueType draws outer contours clockwise: reverse, keeping the start.
    lists.forEach((pts, m) => out[m].push({ points: [pts[0], ...pts.slice(1).reverse()] }));
  });
  return out.map((contours) => ({ contours }));
}

// --- glyf and loca ---

function rounded(glyph) {
  return glyph.contours.map((c) => c.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), on: p.on })));
}

function buildGlyf(glyphs) {
  const w = new Writer();
  const offsets = [];
  let bbox = null, maxPoints = 0, maxContours = 0;
  const grow = (b) => {
    if (!b) return;
    bbox = bbox ? [Math.min(bbox[0], b[0]), Math.min(bbox[1], b[1]), Math.max(bbox[2], b[2]), Math.max(bbox[3], b[3])] : b;
  };
  for (const g of glyphs) {
    offsets.push(w.length);
    const contours = rounded(g.regular);
    const pts = contours.flat();
    g.box = boxOf(pts);
    grow(g.box);
    grow(boxOf(rounded(g.bold).flat()));
    if (!pts.length) continue;
    maxPoints = Math.max(maxPoints, pts.length);
    maxContours = Math.max(maxContours, contours.length);
    w.i16(contours.length);
    g.box.forEach((v) => w.i16(v));
    let end = -1;
    for (const c of contours) { end += c.length; w.u16(end); }
    w.u16(0); // no instructions
    const flags = [], xs = new Writer(), ys = new Writer();
    let x = 0, y = 0;
    pts.forEach((p, i) => {
      let f = p.on ? 0x01 : 0;
      if (i === 0) f |= 0x40; // OVERLAP_SIMPLE: contours may overlap
      const dx = p.x - x, dy = p.y - y;
      if (dx === 0) f |= 0x10;
      else if (Math.abs(dx) < 256) { f |= 0x02 | (dx > 0 ? 0x10 : 0); xs.u8(Math.abs(dx)); } else xs.i16(dx);
      if (dy === 0) f |= 0x20;
      else if (Math.abs(dy) < 256) { f |= 0x04 | (dy > 0 ? 0x20 : 0); ys.u8(Math.abs(dy)); } else ys.i16(dy);
      flags.push(f);
      x = p.x; y = p.y;
    });
    flags.forEach((f) => w.u8(f));
    w.bytesOf(xs.data);
    w.bytesOf(ys.data);
    w.pad(4);
  }
  offsets.push(w.length);
  const loca = new Writer();
  offsets.forEach((o) => loca.u32(o));
  return { glyf: w.bytes(), loca: loca.bytes(), bbox: bbox ?? [0, 0, 0, 0], maxPoints, maxContours };
}

function boxOf(pts) {
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// --- gvar: one variation (the bold master, at the end of the axis) ---

function buildGvar(glyphs) {
  const data = glyphs.map((g) => {
    const reg = rounded(g.regular).flat(), bold = rounded(g.bold).flat();
    const dx = reg.map((p, i) => bold[i].x - p.x), dy = reg.map((p, i) => bold[i].y - p.y);
    // Phantom points: origin, advance, top and bottom.
    dx.push(0, g.advance[1] - g.advance[0], 0, 0);
    dy.push(0, 0, 0, 0);
    if (dx.every((v) => v === 0) && dy.every((v) => v === 0)) return new Uint8Array(0);
    const deltas = new Writer();
    packDeltas(deltas, dx);
    packDeltas(deltas, dy);
    const w = new Writer();
    w.u16(0x8000 | 1);   // shared point numbers, one tuple
    w.u16(8);            // serialized data after the header
    w.u16(deltas.length); w.u16(0); // tuple 0 of the shared tuples
    w.u8(0);             // shared point numbers: all points
    w.bytesOf(deltas.data);
    w.pad(2);
    return w.bytes();
  });
  const w = new Writer();
  const headerSize = 20, offsetsSize = (glyphs.length + 1) * 4;
  const sharedAt = headerSize + offsetsSize;
  const dataAt = sharedAt + 4;
  w.u16(1); w.u16(0); w.u16(1); w.u16(1);
  w.u32(sharedAt);
  w.u16(glyphs.length); w.u16(1); // long offsets
  w.u32(dataAt);
  let offset = 0;
  for (const d of data) { w.u32(offset); offset += d.length; }
  w.u32(offset);
  w.u16(0x4000); w.u16(0); // shared tuple: wght = 1.0 (and padding)
  data.forEach((d) => w.bytesOf(d));
  return w.bytes();
}

function packDeltas(w, values) {
  let i = 0;
  while (i < values.length) {
    const kind = (v) => (v === 0 ? 0 : v >= -128 && v <= 127 ? 1 : 2);
    const k = kind(values[i]);
    let j = i;
    while (j < values.length && j - i < 64 && kind(values[j]) === k) j++;
    const run = values.slice(i, j);
    if (k === 0) w.u8(0x80 | (run.length - 1));
    else if (k === 1) { w.u8(run.length - 1); run.forEach((v) => w.i8(v)); } else { w.u8(0x40 | (run.length - 1)); run.forEach((v) => w.i16(v)); }
    i = j;
  }
}

// --- Metrics and header tables ---

function buildHmtx(glyphs) {
  const w = new Writer();
  for (const g of glyphs) { w.u16(g.advance[0]); w.i16(g.box ? g.box[0] : 0); }
  return w.bytes();
}

function buildMaxp(numGlyphs, maxPoints, maxContours) {
  const w = new Writer();
  w.u32(0x00010000); w.u16(numGlyphs); w.u16(maxPoints); w.u16(maxContours);
  w.u16(0); w.u16(0); // composite points and contours
  w.u16(2);           // maxZones
  for (let i = 0; i < 8; i++) w.u16(0);
  return w.bytes();
}

function patchHead(head, [xMin, yMin, xMax, yMax]) {
  const out = head.slice(), dv = new DataView(out.buffer);
  dv.setInt16(36, xMin); dv.setInt16(38, yMin); dv.setInt16(40, xMax); dv.setInt16(42, yMax);
  dv.setInt16(50, 1); // long loca offsets
  dv.setInt16(52, 0);
  return out;
}

function patchHhea(hhea, glyphs) {
  const out = hhea.slice(), dv = new DataView(out.buffer);
  const inked = glyphs.filter((g) => g.box);
  dv.setUint16(10, Math.max(...glyphs.map((g) => g.advance[0])));
  dv.setInt16(12, inked.length ? Math.min(...inked.map((g) => g.box[0])) : 0);
  dv.setInt16(14, inked.length ? Math.min(...inked.map((g) => g.advance[0] - g.box[2])) : 0);
  dv.setInt16(16, inked.length ? Math.max(...inked.map((g) => g.box[2])) : 0);
  dv.setUint16(34, glyphs.length);
  return out;
}

function patchOs2(os2, weight) {
  const out = os2.slice();
  new DataView(out.buffer).setUint16(4, weight);
  return out;
}

// post version 3: no glyph names (TrueType fonts don't need them).
function patchPost(post) {
  const out = post.slice(0, 32);
  new DataView(out.buffer).setUint32(0, 0x00030000);
  return out;
}

// --- name, fvar, STAT ---

const psName = (text) => text.normalize("NFD").replace(/[^A-Za-z0-9]/g, "").slice(0, 40) || "Font";

function nameRecords({ family, meta, named }) {
  const version = `Version ${meta.version.trim() || "1.000"}`;
  const records = [
    [1, family], [2, "Regular"], [3, `${version};${psName(family)}-Regular`], [4, `${family} Regular`],
    [5, version], [6, `${psName(family)}-Regular`], [16, family], [17, "Regular"], [25, psName(family)],
    [256, "Weight"],
  ];
  if (meta.designer.trim()) records.push([9, meta.designer.trim()]);
  const instanceIds = named.map((inst, i) => {
    records.push([257 + i, inst.name]);
    return 257 + i;
  });
  return { records: records.sort((a, b) => a[0] - b[0]), axisNameId: 256, instanceIds };
}

function buildName(records) {
  const strings = records.map(([, text]) => {
    const bytes = [];
    for (const ch of text) {
      const code = ch.codePointAt(0);
      if (code > 0xffff) continue;
      bytes.push(code >> 8, code & 0xff);
    }
    return bytes;
  });
  const w = new Writer();
  w.u16(0); w.u16(records.length); w.u16(6 + records.length * 12);
  let offset = 0;
  records.forEach(([id], i) => {
    w.u16(3); w.u16(1); w.u16(0x0409); w.u16(id); w.u16(strings[i].length); w.u16(offset);
    offset += strings[i].length;
  });
  strings.forEach((s) => w.bytesOf(s));
  return w.bytes();
}

function buildFvar(axis, named, names) {
  const w = new Writer();
  w.u16(1); w.u16(0); w.u16(16); w.u16(2);
  w.u16(1); w.u16(20); w.u16(named.length); w.u16(8);
  w.tag("wght"); w.fixed(axis.min); w.fixed(axis.min); w.fixed(axis.max); w.u16(0); w.u16(names.axisNameId);
  named.forEach((inst, i) => { w.u16(names.instanceIds[i]); w.u16(0); w.fixed(inst.weight); });
  return w.bytes();
}

function buildStat(axis, named, names) {
  const w = new Writer();
  const valuesAt = 20 + 8;
  w.u16(1); w.u16(1); w.u16(8); w.u16(1);
  w.u32(20);                 // design axes right after the header
  w.u16(named.length); w.u32(valuesAt);
  w.u16(2);                  // elided fallback name: "Regular"
  w.tag("wght"); w.u16(names.axisNameId); w.u16(0);
  // Offsets (from the offsets array) to format 1 axis values of 12 bytes.
  named.forEach((_, i) => w.u16(named.length * 2 + i * 12));
  named.forEach((inst, i) => {
    w.u16(1); w.u16(0); w.u16(inst.weight === axis.min ? 0x0002 : 0); w.u16(names.instanceIds[i]); w.fixed(inst.weight);
  });
  return w.bytes();
}
