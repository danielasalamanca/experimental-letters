// Font data model, defaults, migration and metric fitting.
// Pure functions only (no DOM), so they can be tested with `node --test`.

import { key, parseKey } from "./geometry.js";

export const FORMAT = "experimental-letters";
export const VERSION = 2;

// Vertical metrics are stored in whole grid rows above the baseline (0).
export const DEFAULT_METRICS = { ascender: 15, capHeight: 14, xHeight: 9, descender: -5 };

// Draw order is top to bottom; the baseline is fixed at 0.
export const METRICS = [
  { key: "ascender", name: "Ascendente", short: "asc", color: "#8b5cf6" },
  { key: "capHeight", name: "Altura de mayúsculas", short: "mayús", color: "#e0484a" },
  { key: "xHeight", name: "Altura de x", short: "x", color: "#2f80ed" },
  { key: "baseline", name: "Línea base", short: "base", color: "#16a34a" },
  { key: "descender", name: "Descendente", short: "desc", color: "#d97706" },
];

export const metricColor = (k) => METRICS.find((m) => m.key === k).color;

// The letter from the original reference sketch, drawn as a lowercase "a".
const SAMPLE_A = [
  [2,8],[3,8],[4,8],[5,8],
  [1,7],[5,7],[6,7],
  [1,6],[2,6],[5,6],[6,6],
  [5,5],[6,5],
  [1,4],[2,4],[3,4],[4,4],[5,4],[6,4],
  [0,3],[1,3],[5,3],[6,3],
  [0,2],[1,2],[5,2],[6,2],
  [0,1],[1,1],[2,1],[4,1],[5,1],[6,1],
  [1,0],[2,0],[3,0],[6,0],[7,0],
].map(([c, r]) => key(c, r));

export function createGlyph({ cols = 8, cells = [], curve = null, metrics = DEFAULT_METRICS } = {}) {
  return { cols, cells: [...cells], curve, metrics: { ...metrics } };
}

export function createFont() {
  return {
    format: FORMAT,
    version: VERSION,
    upm: 1000,
    cell: 50,
    metrics: { ...DEFAULT_METRICS },
    overshoot: 12,
    curve: 1,
    join: { enabled: true, width: 15 },
    view: { ink: "#1d1d1b", paper: "#ffffff", guides: true, metrics: true },
    active: "a",
    glyphs: { a: createGlyph({ cells: SAMPLE_A }) },
    drafts: [],
  };
}

// Converts the first version's data (single letter + "Mis letras") to a font.
// v1 used vertex keys "x,y" counted from the top-left with stars on interior
// vertices; v2 uses cells counted from the baseline.
export function migrateV1(old) {
  const font = createFont();
  const globalCurve = typeof old.curve === "number" ? old.curve : 1;
  const convert = ({ cols = 9, rows = 10, curve = globalCurve, filled = [] }) => {
    const cells = [];
    for (const k of filled) {
      const [x, y] = parseKey(k);
      if (x < 1 || y < 1 || x >= cols || y >= rows) continue;
      cells.push(key(x - 1, rows - 1 - y));
    }
    return createGlyph({
      cols: Math.max(1, cols - 1),
      cells,
      curve: curve === globalCurve ? null : curve,
    });
  };

  font.curve = globalCurve;
  font.view.ink = old.ink ?? font.view.ink;
  font.view.paper = old.paper ?? font.view.paper;
  font.view.guides = old.guides ?? true;
  font.glyphs.a = convert(old);
  font.drafts = (old.gallery ?? []).map(convert);
  return font;
}

// Fills in anything missing so older or hand-edited projects still load.
export function normalizeFont(data) {
  if (!data || typeof data !== "object") return createFont();
  if (data.format !== FORMAT) return migrateV1(data);
  const base = createFont();
  const font = {
    ...base,
    ...data,
    metrics: { ...base.metrics, ...data.metrics },
    join: { ...base.join, ...data.join },
    view: { ...base.view, ...data.view },
    glyphs: { ...data.glyphs },
    drafts: [...(data.drafts ?? [])],
  };
  const fix = (g) => createGlyph({ ...g, metrics: { ...font.metrics, ...g.metrics } });
  for (const k of Object.keys(font.glyphs)) font.glyphs[k] = fix(font.glyphs[k]);
  font.drafts = font.drafts.map(fix);
  if (!font.glyphs[font.active]) font.glyphs[font.active] = createGlyph({ metrics: font.metrics });
  return font;
}

export const glyphCurve = (font, glyph) => glyph.curve ?? font.curve;

export const allGlyphs = (font) => [...Object.values(font.glyphs), ...font.drafts];

export const sameMetrics = (a, b) =>
  a.ascender === b.ascender && a.capHeight === b.capHeight &&
  a.xHeight === b.xHeight && a.descender === b.descender;

// Sets one metric (in rows), clamped so the order
// descender < 0 < xHeight <= capHeight <= ascender always holds.
export function setMetric(metrics, name, rows) {
  const m = { ...metrics };
  const v = Math.round(rows);
  if (name === "descender") m.descender = clamp(v, -40, -1);
  if (name === "xHeight") m.xHeight = clamp(v, 1, m.capHeight);
  if (name === "capHeight") m.capHeight = clamp(v, m.xHeight, m.ascender);
  if (name === "ascender") m.ascender = clamp(v, m.capHeight, 60);
  return m;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// --- "Ajustar glifos a métricas" ---
// Moves a drawing from one set of metrics to another without scaling:
// each zone between two metric lines gains or loses whole rows, like
// inserting or deleting rows in a spreadsheet. Rows above the change shift
// by whole rows, so every point stays on a grid intersection.

const metricLines = (m) => [m.descender, 0, m.xHeight, m.capHeight, m.ascender];

export function fitCells(cells, from, to) {
  const rows = new Map();
  for (const k of cells) {
    const [c, r] = parseKey(k);
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r).push(c);
  }
  const a = metricLines(from);
  const b = metricLines(to);
  const out = [];
  const emit = (r, cols) => cols.forEach((c) => out.push(key(c, r)));

  for (const [r, cols] of rows) {
    if (r < a[0]) emit(r - a[0] + b[0], cols);
    if (r >= a[4]) emit(r - a[4] + b[4], cols);
  }
  for (let i = 0; i < 4; i++) {
    const band = [];
    for (let r = a[i]; r < a[i + 1]; r++) band.push((rows.get(r) ?? []).slice().sort((x, y) => x - y));
    resizeBand(band, b[i + 1] - b[i]).forEach((cols, j) => emit(b[i] + j, cols));
  }
  return out;
}

// Grows or shrinks a list of rows to `size`. Rows that repeat a neighbour
// (straight stems, empty space) are duplicated or removed first; ties go to
// the row closest to the middle of the zone.
export function resizeBand(band, size) {
  const rows = band.slice();
  const same = (i, j) => j >= 0 && j < rows.length && rows[i].join() === rows[j].join();
  const pick = (score) => {
    let best = 0, bestScore = -Infinity;
    const mid = (rows.length - 1) / 2;
    rows.forEach((_, i) => {
      const s = score(i) * 1000 - Math.abs(i - mid);
      if (s > bestScore) { best = i; bestScore = s; }
    });
    return best;
  };
  while (rows.length < size) {
    if (rows.length === 0) { rows.push([]); continue; }
    const i = pick((i) => same(i, i - 1) + same(i, i + 1));
    rows.splice(i, 0, rows[i].slice());
  }
  while (rows.length > size) {
    const i = pick((i) => 2 * (same(i, i - 1) + same(i, i + 1)) + (rows[i].length === 0));
    rows.splice(i, 1);
  }
  return rows;
}

const sortedKeys = (cells) => [...cells].sort().join(" ");

// Plans the fit for every glyph drawn with older metrics.
export function planFit(font) {
  const pending = allGlyphs(font).filter((g) => !sameMetrics(g.metrics, font.metrics));
  const changes = pending.map((glyph) => {
    const cells = fitCells(glyph.cells, glyph.metrics, font.metrics);
    return { glyph, cells, changed: sortedKeys(cells) !== sortedKeys(glyph.cells) };
  });
  return { pending, changes, affected: changes.filter((c) => c.changed).length };
}

export function applyFit(font, plan) {
  for (const { glyph, cells } of plan.changes) {
    glyph.cells = cells;
    glyph.metrics = { ...font.metrics };
  }
}
