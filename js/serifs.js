// Serifs: pieces added at the ends of a letter's vertical stems. A stem end
// is a horizontal run of cells on a metric line (baseline or descender for
// feet; x-height, cap height or ascender for heads) that the rows next to it
// continue unchanged for at least as many rows as it is wide (so the bar of
// an L or the arch of a bowl is not a stem). The serifs are ordinary "poly" or "pill" pieces,
// marked with `serif: true` so they can be remade or removed as a set.

import { key, parseKey } from "./geometry.js";
import { polygonArea } from "./pieces.js";

export const SERIF_STYLES = { slab: "Recta", wedge: "Con cuña", round: "Redondeada" };
export const SERIF_SIDES = { both: "Ambos lados", left: "Izquierda", right: "Derecha", none: "Sin serifa" };
export const SERIF_DEFAULT = { style: "slab", ext: 1, height: 1, wedge: 1, footSide: "both", headSide: "left" };

export const isSerif = (p) => p.serif === true;

// Stem ends of a drawing: { x0, x1, edge, kind } with the run's columns
// x0..x1 (cell edges), the y of the metric line it touches and "foot"/"head".
export function stemEnds(cells, metrics) {
  const set = new Set(cells);
  const has = (c, r) => set.has(key(c, r));
  const bottoms = new Set([0, metrics.descender]);
  const tops = new Set([metrics.xHeight, metrics.capHeight, metrics.ascender]);
  // The row `r` has exactly the run c0..c1 (no neighbours beside it).
  const sameRun = (r, c0, c1) => {
    for (let c = c0; c <= c1; c++) if (!has(c, r)) return false;
    return !has(c0 - 1, r) && !has(c1 + 1, r);
  };
  const ends = [];
  for (const k of set) {
    const [c, r] = parseKey(k);
    if (has(c - 1, r)) continue; // not the start of a run
    let c1 = c;
    while (has(c1 + 1, r)) c1++;
    const free = (row) => { for (let x = c; x <= c1; x++) if (has(x, row)) return false; return true; };
    const width = c1 - c + 1;
    const length = (step) => { let n = 0; while (sameRun(r + step * (n + 1), c, c1)) n++; return n; };
    if (bottoms.has(r) && free(r - 1) && length(1) >= width) ends.push({ x0: c, x1: c1 + 1, edge: r, kind: "foot" });
    if (tops.has(r + 1) && free(r + 1) && length(-1) >= width) ends.push({ x0: c, x1: c1 + 1, edge: r + 1, kind: "head" });
  }
  return ends.sort((a, b) => a.edge - b.edge || a.x0 - b.x0);
}

function serifPiece(end, { style, ext, height, wedge }, side) {
  const dir = end.kind === "foot" ? 1 : -1;
  const L = end.x0 - (side === "both" || side === "left" ? ext : 0);
  const R = end.x1 + (side === "both" || side === "right" ? ext : 0);
  const y = (t) => end.edge + dir * t;
  const base = { corner: "bl", mode: "add", serif: true };
  if (style === "round") {
    const [y0, y1] = [y(0), y(height)].sort((a, b) => a - b);
    return { ...base, shape: "pill", x0: L, y0, x1: R, y1 };
  }
  const b = style === "wedge" ? wedge : 0;
  const pts = [[L, y(0)], [R, y(0)]];
  if (R > end.x1) pts.push([R, y(height)]);
  pts.push([end.x1, y(height + b)], [end.x0, y(height + b)]);
  if (L < end.x0) pts.push([L, y(height)]);
  if (polygonArea(pts) < 0) pts.reverse();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return {
    ...base, shape: "poly", points: pts,
    x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys),
  };
}

// The serif pieces for a drawing; `footSide` and `headSide` say which sides
// of a foot or head get one ("both", "left", "right" or "none").
export function serifPieces(cells, metrics, opts = {}) {
  const o = { ...SERIF_DEFAULT, ...opts };
  const out = [];
  for (const end of stemEnds(cells, metrics)) {
    const side = end.kind === "foot" ? o.footSide : o.headSide;
    if (side !== "none") out.push(serifPiece(end, o, side));
  }
  return out;
}

export const removeSerifs = (glyph) => {
  const before = glyph.pieces.length;
  glyph.pieces = glyph.pieces.filter((p) => !isSerif(p));
  return before - glyph.pieces.length;
};

// Remakes the glyph's serifs (older ones are replaced); returns how many.
export function applySerifs(glyph, metrics, opts) {
  removeSerifs(glyph);
  const added = serifPieces(glyph.cells, metrics, opts);
  glyph.pieces.push(...added);
  return added.length;
}
