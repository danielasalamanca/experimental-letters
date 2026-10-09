// Masters and weights: a Regular master (the drawing) and a bold master
// (e.g. ExtraBold) make the font variable. Every weight in between is
// interpolated point by point, as in Glyphs, so both masters of a letter
// must be "compatible": the same contours, with the same points, in the
// same order.
//
// The bold master of a letter lives in `glyph.bold`: a glyph of its own,
// with its own width in columns, drawn on the grid or edited with nodes. It
// starts as the Regular thickened by `font.axis.thicken` units on every side
// (an outline); it can also start as a copy of the Regular's grid drawing,
// to redraw it wider. While it is still `auto` (never edited) it follows the
// Regular when that changes. Contours and start points are matched to the
// Regular's automatically, so only the number of contours and points (and
// which sides are curved) has to agree.

import { glyphFinalContours } from "./shapes.js";
import { commandsToOutline, outlineToCommands, cloneOutline } from "./nodes.js";
import { advanceWidth } from "./model.js";

export const WEIGHTS = [
  [100, "Thin"], [200, "ExtraLight"], [300, "Light"], [400, "Regular"], [500, "Medium"],
  [600, "SemiBold"], [700, "Bold"], [800, "ExtraBold"], [900, "Black"],
];

export const DEFAULT_AXIS = { min: 400, max: 800, thicken: 20 };

export function normalizeAxis(axis = {}) {
  const num = (v, fallback) => (Number.isFinite(+v) ? +v : fallback);
  let min = Math.round(Math.min(1000, Math.max(1, num(axis.min, DEFAULT_AXIS.min))));
  let max = Math.round(Math.min(1000, Math.max(1, num(axis.max, DEFAULT_AXIS.max))));
  if (max <= min) max = Math.min(1000, min + 100);
  if (max <= min) min = max - 1;
  const thicken = Math.min(400, Math.max(1, num(axis.thicken, DEFAULT_AXIS.thicken)));
  return { min, max, thicken };
}

export const weightName = (w) => WEIGHTS.find(([v]) => v === w)?.[1] ?? `Peso ${w}`;

// Named weights between the two masters (the masters included).
export function instances(axis) {
  const { min, max } = normalizeAxis(axis);
  const out = WEIGHTS.filter(([w]) => w >= min && w <= max).map(([weight, name]) => ({ weight, name }));
  if (!out.some((i) => i.weight === min)) out.unshift({ weight: min, name: weightName(min) });
  if (!out.some((i) => i.weight === max)) out.push({ weight: max, name: weightName(max) });
  return out;
}

// 0 at the Regular, 1 at the bold master.
export const weightT = (axis, weight) => {
  const { min, max } = normalizeAxis(axis);
  return Math.min(1, Math.max(0, (weight - min) / (max - min)));
};

// --- Contours ---
// Commands in cells (y up): { type: "M" | "L" | "C" | "Z", x, y, x1, y1, x2, y2 }.

// Contours as the node outline writes them, so both masters compare alike.
export const normalizeContours = (contours) => outlineToCommands(commandsToOutline(contours));

const shift = (contours, dx, dy) => contours.map((cmds) => cmds.map((c) => {
  if (c.type === "Z") return { type: "Z" };
  const q = { ...c, x: c.x + dx, y: c.y + dy };
  if (c.type === "C") Object.assign(q, { x1: c.x1 + dx, y1: c.y1 + dy, x2: c.x2 + dx, y2: c.y2 + dy });
  return q;
}));

export const structure = (contours) => contours.map((cmds) => cmds.map((c) => c.type).join("")).join("|");

export const compatible = (a, b) => structure(a) === structure(b);

// Why two masters don't match, in words.
export function incompatibility(a, b, boldName = "el máster grueso") {
  if (a.length !== b.length) return `Regular tiene ${a.length} contorno(s) y ${boldName}, ${b.length}.`;
  for (let i = 0; i < a.length; i++) {
    const na = a[i].filter((c) => c.type !== "Z").length, nb = b[i].filter((c) => c.type !== "Z").length;
    if (na !== nb) return `El contorno ${i + 1} tiene ${na} punto(s) en Regular y ${nb} en ${boldName}.`;
    if (structure([a[i]]) !== structure([b[i]])) return `En el contorno ${i + 1} un tramo es recto en un máster y curvo en el otro.`;
  }
  return "";
}

export function interpolateContours(a, b, t) {
  const lerp = (p, q) => p + (q - p) * t;
  return a.map((cmds, i) => cmds.map((c, j) => {
    const d = b[i][j];
    if (c.type === "Z") return { type: "Z" };
    const q = { type: c.type, x: lerp(c.x, d.x), y: lerp(c.y, d.y) };
    if (c.type === "C") Object.assign(q, { x1: lerp(c.x1, d.x1), y1: lerp(c.y1, d.y1), x2: lerp(c.x2, d.x2), y2: lerp(c.y2, d.y2) });
    return q;
  }));
}

// A short fingerprint of contours, to notice when the Regular changed.
export function signature(contours) {
  const text = contours.map((cmds) => cmds.map((c) => c.type + [c.x, c.y, c.x1, c.y1, c.x2, c.y2]
    .filter((v) => v !== undefined).map((v) => Math.round(v * 1000)).join(",")).join(" ")).join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36) + ":" + text.length;
}

// --- Thickening ---
// Every node moves away from the ink by `d` (cells), along the bisector of
// its two sides (a miter), and curve handles grow with their segment, so the
// result keeps exactly the same points: it stays compatible.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const unit = (v) => {
  const l = Math.hypot(v[0], v[1]);
  return l < 1e-12 ? null : [v[0] / l, v[1] / l];
};

function cubicPoint(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
}

// Each contour as a polyline, for winding tests.
function polylines(outline) {
  return outline.map(({ nodes }) => {
    const pts = [];
    nodes.forEach((a, i) => {
      const b = nodes[(i + 1) % nodes.length];
      const p0 = [a.x, a.y], p3 = [b.x, b.y];
      if (a.out || b.in) {
        const p1 = a.out ? [a.x + a.out[0], a.y + a.out[1]] : p0;
        const p2 = b.in ? [b.x + b.in[0], b.y + b.in[1]] : p3;
        for (let s = 0; s < 8; s++) pts.push(cubicPoint(p0, p1, p2, p3, s / 8));
      } else pts.push(p0);
    });
    return pts;
  });
}

function winding([px, py], polys) {
  let w = 0;
  for (const pts of polys) {
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      const cross = (bx - ax) * (py - ay) - (px - ax) * (by - ay);
      if (ay <= py && by > py && cross > 0) w++;
      else if (ay > py && by <= py && cross < 0) w--;
    }
  }
  return w;
}

// +1 if the ink is on the left of the contour's direction, -1 if on the right.
function inkSide(polys, ci) {
  const pts = polys[ci];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const t = unit(sub(b, a));
    if (!t) continue;
    const eps = Math.min(1e-3, Math.hypot(...sub(b, a)) / 4);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return winding([mid[0] - t[1] * eps, mid[1] + t[0] * eps], polys) !== 0 ? 1 : -1;
  }
  return 1;
}

export function thickenOutline(outline, d) {
  const polys = polylines(outline);
  return outline.map((contour, ci) => {
    const { nodes } = contour;
    const n = nodes.length;
    const side = inkSide(polys, ci);
    const at = (node) => [node.x, node.y];
    const moved = nodes.map((node, i) => {
      const prev = nodes[(i - 1 + n) % n], next = nodes[(i + 1) % n];
      const from = prev.out ? [prev.x + prev.out[0], prev.y + prev.out[1]] : at(prev);
      const to = next.in ? [next.x + next.in[0], next.y + next.in[1]] : at(next);
      let tin = unit(node.in ? [-node.in[0], -node.in[1]] : sub(at(node), from)) ?? unit(sub(at(node), at(prev)));
      let tout = unit(node.out ? node.out : sub(to, at(node))) ?? unit(sub(at(next), at(node)));
      tin ??= tout; tout ??= tin;
      if (!tin) return { x: node.x, y: node.y, in: node.in && [...node.in], out: node.out && [...node.out] };
      // Away from the ink: the right of the direction when the ink is on the left.
      const away = (t) => [t[1] * side, -t[0] * side];
      const n1 = away(tin), n2 = away(tout);
      const denom = 1 + n1[0] * n2[0] + n1[1] * n2[1];
      let v;
      if (denom > 0.05) {
        v = [(n1[0] + n2[0]) / denom, (n1[1] + n2[1]) / denom];
        const len = Math.hypot(v[0], v[1]);
        if (len > 2.5) v = [v[0] / len * 2.5, v[1] / len * 2.5]; // sharp points: limit the miter
      } else {
        // A spike (both sides leave almost in opposite directions, like the
        // points of the stars): it moves along itself, out of the ink.
        const near = (a, b, t) => {
          const p1 = a.out ? [a.x + a.out[0], a.y + a.out[1]] : at(a);
          const p2 = b.in ? [b.x + b.in[0], b.y + b.in[1]] : at(b);
          return cubicPoint(at(a), p1, p2, at(b), t);
        };
        const pIn = near(prev, node, 0.9), pOut = near(node, next, 0.1);
        const m = unit(sub([(pIn[0] + pOut[0]) / 2, (pIn[1] + pOut[1]) / 2], at(node))) ?? n1;
        const inside = winding([node.x + m[0] * 1e-3, node.y + m[1] * 1e-3], polys) !== 0;
        v = inside ? [-m[0], -m[1]] : m;
      }
      return { x: node.x + v[0] * d, y: node.y + v[1] * d, in: node.in && [...node.in], out: node.out && [...node.out] };
    });
    // Handles grow (or shrink) with the distance between their nodes.
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (!(nodes[i].out || nodes[j].in)) continue;
      const before = Math.hypot(nodes[j].x - nodes[i].x, nodes[j].y - nodes[i].y);
      if (before < 1e-9) continue;
      const r = Math.hypot(moved[j].x - moved[i].x, moved[j].y - moved[i].y) / before;
      if (moved[i].out) moved[i].out = [moved[i].out[0] * r, moved[i].out[1] * r];
      if (moved[j].in) moved[j].in = [moved[j].in[0] * r, moved[j].in[1] * r];
    }
    return { closed: contour.closed, nodes: moved };
  });
}

// --- Matching the bold master to the Regular ---
// Contours drawn separately (e.g. both masters on the grid) can come out in
// another order, start at another point or run the other way. Each Regular
// contour gets the bold contour, start point and direction that fits it best
// (comparing positions within each master's bounding box).

const segmentKinds = (contour) => contour.nodes.map((a, i) => {
  const b = contour.nodes[(i + 1) % contour.nodes.length];
  return a.out || b.in ? "C" : "L";
}).join("");

const reversed = (c) => ({ ...c, nodes: [...c.nodes].reverse().map((n) => ({ ...n, in: n.out, out: n.in })) });
const rotated = (c, r) => ({ ...c, nodes: [...c.nodes.slice(r), ...c.nodes.slice(0, r)] });

function unitBox(outline) {
  const xs = outline.flatMap((c) => c.nodes.map((n) => n.x)), ys = outline.flatMap((c) => c.nodes.map((n) => n.y));
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0 || 1, h = Math.max(...ys) - y0 || 1;
  return (n) => [(n.x - x0) / w, (n.y - y0) / h];
}

export function matchOutline(regular, bold, boldName = "el máster grueso") {
  if (regular.length !== bold.length) {
    return { reason: `Regular tiene ${regular.length} contorno(s) y ${boldName}, ${bold.length}.` };
  }
  const nr = unitBox(regular), nb = unitBox(bold);
  const used = new Set();
  const out = [];
  for (const [i, rc] of regular.entries()) {
    const kinds = segmentKinds(rc);
    let best = null;
    for (const [j, bc] of bold.entries()) {
      if (used.has(j) || bc.nodes.length !== rc.nodes.length) continue;
      for (const dir of [bc, reversed(bc)]) {
        for (let r = 0; r < dir.nodes.length; r++) {
          const cand = rotated(dir, r);
          if (segmentKinds(cand) !== kinds) continue;
          let cost = 0;
          cand.nodes.forEach((n, k) => {
            const [ax, ay] = nr(rc.nodes[k]), [bx, by] = nb(n);
            cost += (ax - bx) ** 2 + (ay - by) ** 2;
          });
          if (!best || cost < best.cost) best = { j, cand, cost };
        }
      }
    }
    if (!best) {
      const sizes = bold.filter((_, j) => !used.has(j)).map((c) => c.nodes.length);
      return {
        reason: sizes.includes(rc.nodes.length)
          ? `En el contorno ${i + 1}, las esquinas redondeadas (o las curvas) no coinciden con ${boldName}: redondea las mismas esquinas en los dos másteres.`
          : `El contorno ${i + 1} del Regular tiene ${rc.nodes.length} punto(s); en ${boldName} ningún contorno tiene esa cantidad (${sizes.join(", ")}).`,
      };
    }
    used.add(best.j);
    out.push(best.cand);
  }
  return { outline: out };
}

// The bold master's own contours, as a node outline.
function boldOutline(font, bold) {
  const plain = !bold.cells.length && !(bold.pieces ?? []).length && !Object.keys(bold.corners ?? {}).length;
  if (plain) return cloneOutline(bold.outline ?? []);
  return commandsToOutline(glyphFinalContours(font, bold));
}

// --- Masters of a letter ---

// A letter made only of components (á = a + ´): its masters are built from
// the masters of its parts.
export const pureComposite = (glyph) =>
  glyph.components.length > 0 && !glyph.cells.length && !glyph.outline && !(glyph.pieces ?? []).length;

const cellsOf = (font, units) => units / font.cell;

// A new bold master for a letter: its Regular thickened by `font.axis.thicken`.
// The drawing moves right by the same amount and gets twice as wide, so the
// sidebearings stay the same.
export function makeBold(font, glyph) {
  const regular = normalizeContours(glyphFinalContours(font, glyph));
  const d = cellsOf(font, normalizeAxis(font.axis).thicken);
  const thick = thickenOutline(commandsToOutline(regular), d);
  const outline = thick.map((c) => ({ ...c, nodes: c.nodes.map((n) => ({ ...n, x: n.x + d })) }));
  return boldGlyph(font, glyph, {
    outline, cols: glyph.cols + (regular.length ? 2 * d : 0), auto: true, source: signature(regular),
  });
}

// The bold master as a glyph object, so the editor's tools can work on it.
export function boldGlyph(font, glyph, { outline, cols, lsb = glyph.lsb, rsb = glyph.rsb, auto = false, source = null }) {
  return {
    cols, cells: [], curve: null, metrics: { ...font.metrics }, lsb, rsb, grid: null, rounding: 0,
    corners: {}, pieces: [], outline: cloneOutline(outline), components: [],
    auto, source,
  };
}

// A bold master that starts as a copy of the Regular's drawing (cells,
// corners, pieces or nodes), to redraw it on the grid, wider or thicker.
export function copyRegular(font, glyph) {
  const copy = JSON.parse(JSON.stringify({ ...glyph, components: [], bold: null }));
  return { ...copy, metrics: { ...font.metrics }, auto: false, source: null };
}

// The bold master kept in the letter, regenerated if it is automatic and the
// Regular changed. Returns it (or null for pure composites).
export function refreshBold(font, char) {
  const glyph = font.glyphs[char];
  if (!glyph || pureComposite(glyph)) return null;
  if (!glyph.bold) {
    glyph.bold = makeBold(font, glyph);
  } else if (glyph.bold.auto) {
    const regular = normalizeContours(glyphFinalContours(font, glyph));
    if (glyph.bold.source !== signature(regular)) glyph.bold = makeBold(font, glyph);
  }
  return glyph.bold;
}

// Both masters of a letter, in cells, with widths and sidebearings in units.
// status: "ok", "empty" (no ink) or "incompatible" (with `reason`).
export function masterPair(font, char, seen = new Set()) {
  const glyph = font.glyphs[char];
  const regAdvance = advanceWidth(font, glyph);
  if (pureComposite(glyph)) return compositePair(font, char, glyph, seen);
  const regOutline = commandsToOutline(glyphFinalContours(font, glyph));
  const regular = outlineToCommands(regOutline);
  // Letters whose bold master was never opened get the automatic one.
  let bold = glyph.bold;
  if (!bold || (bold.auto && bold.source !== signature(regular))) bold = makeBold(font, glyph);
  const own = boldOutline(font, bold);
  const pair = { regular, bold: outlineToCommands(own), advance: [regAdvance, advanceWidth(font, bold)], lsb: [glyph.lsb, bold.lsb] };
  if (!regular.length && !own.length) return { ...pair, status: "empty" };
  const match = matchOutline(regOutline, own, weightName(normalizeAxis(font.axis).max));
  if (match.reason) return { ...pair, status: "incompatible", reason: match.reason };
  return { ...pair, bold: outlineToCommands(match.outline), status: "ok" };
}

function compositePair(font, char, glyph, seen) {
  const regAdvance = advanceWidth(font, glyph);
  const parts = glyph.components
    .filter((c) => font.glyphs[c.glyph] && !seen.has(c.glyph) && c.glyph !== char)
    .map((c) => ({ c, pair: masterPair(font, c.glyph, new Set([...seen, char])) }));
  const regular = parts.flatMap(({ c, pair }) => shift(pair.regular, c.dx, c.dy));
  const failed = parts.find(({ pair }) => pair.status === "incompatible");
  const growth = (pair) => (pair.advance[1] - pair.advance[0]) / 2 / font.cell;
  const baseGrowth = parts.length ? growth(parts[0].pair) : 0;
  const advance = [regAdvance, regAdvance + (parts.length ? parts[0].pair.advance[1] - parts[0].pair.advance[0] : 0)];
  const lsb = [glyph.lsb, glyph.lsb + (parts.length ? parts[0].pair.lsb[1] - parts[0].pair.lsb[0] : 0)];
  if (failed) {
    return {
      regular, bold: null, advance: [regAdvance, regAdvance], lsb: [glyph.lsb, glyph.lsb], composite: true,
      status: failed.pair.status, reason: `Depende de «${failed.c.glyph}»: ${failed.pair.reason}`,
    };
  }
  // Accents keep centred over the base, which grew on both sides.
  const bold = parts.flatMap(({ c, pair }, i) =>
    shift(pair.bold ?? [], c.dx + (i === 0 ? 0 : baseGrowth - growth(pair)), c.dy));
  return { regular, bold, advance, lsb, composite: true, status: regular.length || bold.length ? "ok" : "empty" };
}

// The letter at a weight: contours (cells), advance and lsb (units). Letters
// whose masters don't match stay as in the Regular.
export function atWeight(font, char, weight) {
  const pair = masterPair(font, char);
  const t = weightT(font.axis, weight);
  if (pair.status !== "ok" || t === 0) {
    return { contours: pair.regular, advance: pair.advance[0], lsb: pair.lsb[0], status: pair.status };
  }
  return {
    contours: interpolateContours(pair.regular, pair.bold, t),
    advance: pair.advance[0] + (pair.advance[1] - pair.advance[0]) * t,
    lsb: pair.lsb[0] + (pair.lsb[1] - pair.lsb[0]) * t,
    status: pair.status,
  };
}

// How the bold master is going, letter by letter.
export function mastersReport(font, chars) {
  const report = { ok: [], edited: [], incompatible: [], empty: [] };
  for (const char of chars) {
    const glyph = font.glyphs[char];
    if (!glyph) continue;
    const pair = masterPair(font, char);
    report[pair.status].push(char);
    if (pair.status === "ok" && glyph.bold && !glyph.bold.auto) report.edited.push(char);
  }
  return report;
}
