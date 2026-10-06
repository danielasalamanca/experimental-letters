// Drawing-tool helpers: mirroring, selections and strokes. Pure functions
// on cell keys, so they can be tested with `node --test`.

import { key, parseKey } from "./geometry.js";

// Vertical mirror axis: the middle of a pair of metric lines (in rows).
export const AXES = {
  auto: "Automático",
  x: "Base – altura de x",
  cap: "Base – mayúsculas",
  full: "Descendente – ascendente",
};

export function axisRows(axis, metrics, char) {
  if (axis === "auto") axis = /[A-ZÑ0-9]/.test(char) ? "cap" : "x";
  if (axis === "cap") return [0, metrics.capHeight];
  if (axis === "full") return [metrics.descender, metrics.ascender];
  return [0, metrics.xHeight];
}

// The cell plus its mirror images. `h` mirrors left–right across the glyph's
// columns; `v` mirrors top–bottom across the rows [lo, hi).
export function mirrorKeys(k, { h = false, v = false, cols, rows: [lo, hi] = [0, 0] }) {
  const [c, r] = parseKey(k);
  const cs = h ? [c, cols - 1 - c] : [c];
  const rs = v ? [r, lo + hi - 1 - r] : [r];
  const out = new Set();
  for (const x of cs) for (const y of rs) out.add(key(x, y));
  return [...out];
}

export const translate = (cells, dc, dr) =>
  cells.map((k) => {
    const [c, r] = parseKey(k);
    return key(c + dc, r + dr);
  });

// Cells whose centre falls inside the rectangle (in cell units).
export function cellsInRect(cells, x0, y0, x1, y1) {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  return cells.filter((k) => {
    const [c, r] = parseKey(k);
    return c + 0.5 >= ax && c + 0.5 <= bx && r + 0.5 >= ay && r + 0.5 <= by;
  });
}

// A "stroke": every cell connected to `start` through side neighbours,
// which is how stars join into a continuous line.
export function connectedCells(cells, start) {
  const set = new Set(cells);
  if (!set.has(start)) return [];
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const [c, r] = parseKey(queue.pop());
    for (const n of [key(c + 1, r), key(c - 1, r), key(c, r + 1), key(c, r - 1)]) {
      if (set.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  return [...seen];
}

// --- What travels with a selection of cells ---
// Moving, copying or deleting cells also takes the rounded corners and the
// pieces that belong to them: a corner on (or at the edge of) a selected
// cell, and a piece lying inside the selection's area.

const pointKey = (x, y) => {
  const f = (v) => String(Math.round(v * 1000) / 1000);
  return `${f(x)},${f(y)}`;
};

export function selectionExtras(glyph, selected) {
  const cells = [...selected].map(parseKey);
  if (!cells.length) return { corners: [], pieces: [] };
  const onCell = (x, y) => cells.some(([c, r]) => x >= c - 1e-9 && x <= c + 1 + 1e-9 && y >= r - 1e-9 && y <= r + 1 + 1e-9);
  const corners = Object.keys(glyph.corners ?? {}).filter((k) => onCell(...parseKey(k)));
  const minX = Math.min(...cells.map(([c]) => c)), maxX = Math.max(...cells.map(([c]) => c)) + 1;
  const minY = Math.min(...cells.map(([, r]) => r)), maxY = Math.max(...cells.map(([, r]) => r)) + 1;
  const inside = (x, y) => x >= minX - 1e-9 && x <= maxX + 1e-9 && y >= minY - 1e-9 && y <= maxY + 1e-9;
  const pieces = [];
  (glyph.pieces ?? []).forEach((p, i) => {
    const pts = p.points ?? [[p.x0, p.y0], [p.x1, p.y1]];
    if (pts.every(([x, y]) => inside(x, y)) && inside(p.x0, p.y0) && inside(p.x1, p.y1)) pieces.push(i);
  });
  return { corners, pieces };
}

export function translateCorner(k, dc, dr) {
  const [x, y] = parseKey(k);
  return pointKey(x + dc, y + dr);
}

export function translatePiece(p, dc, dr) {
  const q = { ...p, x0: p.x0 + dc, x1: p.x1 + dc, y0: p.y0 + dr, y1: p.y1 + dr };
  if (p.points) q.points = p.points.map(([x, y]) => [x + dc, y + dr]);
  return q;
}
