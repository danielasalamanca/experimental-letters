// Automatic ("optical") kerning, from the drawings themselves.
//
// Every glyph gets two profiles: at each horizontal scanline, how far its ink
// is from the left and from the right edge of its advance width. For a pair,
// adding the first letter's right profile to the second's left one gives the
// white between them, row by row. Its average, with deep openings counted
// only up to a limit (the eye doesn't see all of the space under a T), is
// compared with the white of the control letters (nn, no, oo / HH, HO, OO,
// or the sidebearings while those aren't drawn):
// pairs as open or as tight as those keep their sidebearings, the rest are
// kerned by the difference. Nothing is stored: the values follow the drawing,
// and a value set by hand (pair or groups) always wins (see model.js).

import { setAutoKernSource, exportChars, advanceWidth, glyphShape, resolvedCells, capitalOf } from "./model.js";
import { glyphFinalContours } from "./shapes.js";
import { baseChar, caseOf } from "./charset.js";

const STEP = 10;          // distance between scanlines, units
const DEPTH = 0.4;        // how deep an opening counts, in x-heights
const STRENGTH = 0.85;    // share of the optical difference that is kerned
const MIN_VALUE = 10;     // smaller values aren't worth a pair
const ROUND = 5;
const MAX_KERN = 0.2;     // largest value, in em
const MIN_DISTANCE = 0.04; // closest two letters may get, in em
const CURVE_STEPS = 16;
const ROUND_EXTRA = 0.4;  // without control letters, see typicalRange

// --- Which pairs are kerned ---

const PUNCTUATION = new Set([...".,;:!¡?¿-–—'\"‘’“”«»()/"]);

function kindOf(key) {
  if (caseOf(key)) return null;
  const char = baseChar(key);
  if (PUNCTUATION.has(char)) return "punct";
  if (/^[0-9]$/.test(char)) return "digit";
  // The standalone accents (´ ¨ ˜) are components, never typed.
  if (!/^\p{L}$/u.test(char) || char === "˜") return null;
  if (char !== char.toLowerCase()) return "upper";
  return char !== char.toUpperCase() ? "lower" : null;
}

// Pairs that happen in text: not a lowercase before a capital, not letters
// against digits, not two punctuation marks.
function eligible(a, b) {
  if (!a || !b || (a === "punct" && b === "punct")) return false;
  if (a === "punct" || b === "punct") return true;
  if (a === "digit" || b === "digit") return a === b;
  return !(a === "lower" && b === "upper");
}

// --- Profiles ---

// The ink's leftmost and rightmost x on each scanline, in units. Row i is at
// y = (i + 0.5) * STEP.
function scan(contours, cu, lsb) {
  const rows = new Map();
  const segment = (x0, y0, x1, y1) => {
    if (y0 === y1) return;
    const from = Math.ceil(Math.min(y0, y1) / STEP - 0.5);
    const to = Math.floor(Math.max(y0, y1) / STEP - 0.5);
    for (let i = from; i <= to; i++) {
      const x = x0 + ((x1 - x0) * ((i + 0.5) * STEP - y0)) / (y1 - y0);
      const row = rows.get(i);
      if (!row) rows.set(i, [x, x]);
      else if (x < row[0]) row[0] = x;
      else if (x > row[1]) row[1] = x;
    }
  };
  const X = (x) => lsb + x * cu, Y = (y) => y * cu;
  for (const contour of contours) {
    let start = null, at = null;
    const lineTo = (p) => { segment(...at, ...p); at = p; };
    for (const c of contour) {
      if (c.type === "M") start = at = [X(c.x), Y(c.y)];
      else if (c.type === "L") lineTo([X(c.x), Y(c.y)]);
      else if (c.type === "C") {
        const p = [at, [X(c.x1), Y(c.y1)], [X(c.x2), Y(c.y2)], [X(c.x), Y(c.y)]];
        for (let s = 1; s <= CURVE_STEPS; s++) {
          const t = s / CURVE_STEPS, u = 1 - t;
          lineTo([0, 1].map((k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]));
        }
      } else if (start) lineTo(start);
    }
    if (start) lineTo(start);
  }
  return rows;
}

// Openings are never counted deeper than 45° from the ink around them, so
// narrow notches and the gaps between separate dots don't count as space.
function soften(raw) {
  const out = Float64Array.from(raw);
  for (let i = 1; i < out.length; i++) out[i] = Math.min(out[i], out[i - 1] + STEP);
  for (let i = out.length - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] + STEP);
  return out;
}

// { first (row), count, left, right (distances to the advance's edges,
// Infinity without ink), softLeft, softRight, edgeLeft, edgeRight }, or null
// for an empty glyph. `top`: how high the edges are looked for.
function buildProfile(font, glyph, top) {
  const rows = scan(glyphFinalContours(font, glyph), font.cell, glyph.lsb);
  if (!rows.size) return null;
  let first = Infinity, last = -Infinity;
  for (const i of rows.keys()) { first = Math.min(first, i); last = Math.max(last, i); }
  const count = last - first + 1;
  const advance = advanceWidth(font, glyph);
  const left = new Float64Array(count).fill(Infinity);
  const right = new Float64Array(count).fill(Infinity);
  for (const [i, [x0, x1]] of rows) {
    left[i - first] = x0;
    right[i - first] = advance - x1;
  }
  // The outermost ink between the baseline and `top` (else anywhere).
  const edge = (side) => {
    let best = Infinity;
    for (let k = 0; k < count; k++) {
      const y = (first + k + 0.5) * STEP;
      if (y > 0 && y < top) best = Math.min(best, side[k]);
    }
    return best < Infinity ? best : side.reduce((a, b) => Math.min(a, b), Infinity);
  };
  return {
    first, count, left, right,
    softLeft: soften(left), softRight: soften(right),
    edgeLeft: edge(left), edgeRight: edge(right),
  };
}

// Profiles by drawing, so only the letters that changed are measured again.
const cache = new Map();

function profileOf(font, glyph, top) {
  const signature = JSON.stringify([
    font.cell, font.join, font.style, font.stroke, top,
    glyph.lsb, glyph.rsb, glyph.cols, resolvedCells(font, glyph), glyphShape(font, glyph),
  ]);
  if (!cache.has(signature)) {
    if (cache.size > 1000) cache.clear();
    cache.set(signature, buildProfile(font, glyph, top));
  }
  return cache.get(signature);
}

// --- Pairs ---

// A kerner for the font as it is now: kern(left, right) in units. Make a new
// one after any change; it measures each letter once, when first needed.
export function autoKerner(font) {
  const cu = font.cell, m = font.metrics;
  const xHeight = m.xHeight > 0 ? m.xHeight * cu : font.upm * 0.45;
  const capHeight = m.capHeight > 0 ? m.capHeight * cu : font.upm * 0.7;
  const depth = Math.max(STEP * 2, DEPTH * xHeight);
  const strength = STRENGTH * ((font.autoKern?.strength ?? 100) / 100);
  const topOf = { lower: xHeight, upper: capHeight, digit: capHeight, punct: Infinity };

  const letters = new Map();
  const letter = (key) => {
    if (!letters.has(key)) {
      const glyph = font.glyphs[key];
      const kind = glyph ? kindOf(key) : null;
      const profile = kind ? profileOf(font, glyph, topOf[kind]) : null;
      letters.set(key, profile && { ...profile, kind });
    }
    return letters.get(key);
  };

  // Average white between two letters over the height they share (from the
  // baseline to the x-height or cap height), or null if they share none.
  const white = (a, b) => {
    const from = Math.max(a.first, b.first, 0);
    const to = Math.min(a.first + a.count, b.first + b.count,
      Math.round(Math.min(topOf[a.kind], topOf[b.kind]) / STEP));
    if (to - from < 2) return null;
    let sum = 0;
    for (let i = from; i < to; i++) {
      sum += Math.min(a.softRight[i - a.first], a.edgeRight + depth)
        + Math.min(b.softLeft[i - b.first], b.edgeLeft + depth);
    }
    return sum / (to - from);
  };

  // The range of white the control letters have: [low, high].
  const ranges = {};
  const range = (kind) => {
    if (kind in ranges) return ranges[kind];
    const [straight, round] = kind === "lower" ? ["n", "o"] : ["H", "O"];
    const controls = [straight, round].map((c) => capitalOf(font, c) ?? c);
    const values = [];
    for (const l of controls) {
      for (const r of controls) {
        const a = letter(l), b = letter(r);
        const w = a && b ? white(a, b) : null;
        if (w !== null) values.push(w);
      }
    }
    values.sort((x, y) => x - y);
    return (ranges[kind] = values.length ? [values[0], values.at(-1)] : null);
  };
  // Without control letters: from the sidebearings of the drawn letters (the
  // white between two straight sides) up to what two round sides would leave.
  let typical;
  const typicalRange = () => {
    if (typical !== undefined) return typical;
    const values = [];
    for (const key of exportChars(font)) {
      const a = letter(key);
      if (a && a.kind !== "punct") values.push(a.edgeLeft + a.edgeRight);
    }
    values.sort((x, y) => x - y);
    const middle = values[Math.floor(values.length / 2)];
    return (typical = values.length ? [middle, middle + depth * ROUND_EXTRA] : null);
  };
  const rangeFor = (a, b) => {
    const cases = [a, b].filter((k) => k !== "punct").map((k) => (k === "lower" ? "lower" : "upper"));
    const own = cases.map(range).filter(Boolean);
    const found = own.length ? own : [range("lower"), range("upper")].filter(Boolean);
    if (!found.length) return typicalRange();
    return [Math.min(...found.map((r) => r[0])), Math.max(...found.map((r) => r[1]))];
  };

  // The smallest horizontal distance between the two inks, also looking a
  // little above and below, so diagonals and arms don't touch.
  const closest = (a, b, reach) => {
    let best = Infinity;
    for (let k = 0; k < a.count; k++) {
      if (a.right[k] === Infinity) continue;
      const row = a.first + k - b.first;
      for (let j = Math.max(0, row - reach); j <= Math.min(b.count - 1, row + reach); j++) {
        best = Math.min(best, a.right[k] + b.left[j]);
      }
    }
    return best;
  };

  const measure = (left, right) => {
    const a = letter(left), b = letter(right);
    if (!a || !b || !eligible(a.kind, b.kind)) return 0;
    const limits = rangeFor(a.kind, b.kind);
    if (!limits) return 0;
    const [low, high] = limits;
    const w = white(a, b);
    const difference = w === null ? 0 : w > high ? high - w : w < low ? low - w : 0;
    const max = MAX_KERN * font.upm;
    let value = Math.max(-max, Math.min(max, difference * strength));
    // Tightening stops at the minimum distance; a pair is only pushed apart
    // when it already comes closer than half of it, so diagonals with small
    // sidebearings stay put. Fonts that touch on purpose keep touching.
    const minimum = low > 0 ? Math.min(low / 2, MIN_DISTANCE * font.upm) : low;
    const distance = closest(a, b, Math.ceil(Math.max(minimum, 0) / STEP));
    const floor = Math.max(Math.min(0, minimum - distance), (low > 0 ? minimum / 2 : minimum) - distance);
    value = Math.round(value / ROUND) * ROUND;
    if (value < floor) value = Math.ceil(floor / ROUND) * ROUND;
    return Math.abs(value) < MIN_VALUE ? 0 : value;
  };

  const values = new Map();
  return (left, right) => {
    const k = `${left}\u0000${right}`;
    if (!values.has(k)) values.set(k, measure(left, right));
    return values.get(k);
  };
}

setAutoKernSource(autoKerner);
