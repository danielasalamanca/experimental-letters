// Font data model, defaults, migration and metric fitting.
// Pure functions only (no DOM), so they can be tested with `node --test`.

import { key, parseKey, windingAt } from "./geometry.js";
import { CHARSET, COMPOSITES, INVERTED_PUNCTUATION, defaultCols, alternateOf, alternateKey, caseOf, caseKey } from "./charset.js";
import { cloneOutline, shiftOutline, outlineToCommands } from "./nodes.js";
import { pieceContour, contourObjects } from "./pieces.js";

export const FORMAT = "experimental-letters";
export const VERSION = 3;

// Vertical metrics are stored in whole grid rows above the baseline (0).
export const DEFAULT_METRICS = { ascender: 15, capHeight: 14, xHeight: 9, descender: -5 };

// Draw order is top to bottom; the baseline is fixed at 0.
export const METRICS = [
  { key: "ascender", name: "Ascendente", short: "asc", color: "#b9b5ac" },
  { key: "capHeight", name: "Altura de mayúsculas", short: "mayús", color: "#ff48b0" },
  { key: "xHeight", name: "Altura de x", short: "x", color: "#e4ff4f" },
  { key: "baseline", name: "Línea base", short: "base", color: "#111111" },
  { key: "descender", name: "Descendente", short: "desc", color: "#8a8780" },
];

export const metricColor = (k) => METRICS.find((m) => m.key === k).color;

// Ink and paper of new fonts: the editor's #111 on white. Fonts still on
// an earlier default move to these.
export const DEFAULT_INK = "#111111";
export const DEFAULT_PAPER = "#ffffff";
const OLD_DEFAULTS = { ink: ["#1d1d1b", "#302b38"], paper: ["#fefcf8"] };

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

// A glyph: its own drawing (cells), width in cells, sidebearings in units,
// an optional curvature override and components reused from other glyphs.
// `metrics` remembers the metrics it was drawn with (see planFit).
export function createGlyph({
  cols = 8, cells = [], curve = null, metrics = DEFAULT_METRICS,
  lsb = 50, rsb = 50, components = [], grid = null, rounding = null, corners = {}, pieces = [],
  outline = null, bold = null,
} = {}) {
  return {
    cols, cells: [...cells], curve, metrics: { ...metrics }, lsb, rsb, grid, rounding,
    // Square grid: radius (cells or "max") of single corners, by lattice point.
    corners: { ...corners },
    // Square grid: pieces (triangles, quarter ellipses…) added or cut on top.
    pieces: pieces.map((p) => ({ ...p, ...(p.points ? { points: p.points.map((q) => [...q]) } : {}) })),
    // Edited node by node ("Nodos"): replaces the glyph's own grid drawing.
    outline: Array.isArray(outline) ? cloneOutline(outline) : null,
    components: components.map(cloneComponent),
    // The bold master (see masters.js): a glyph of its own (grid drawing or
    // nodes, width, sidebearings), or null while it is generated automatically.
    bold: bold && typeof bold === "object" ? {
      ...createGlyph({ ...bold, metrics, components: [], bold: null }),
      auto: !!bold.auto, source: bold.source ?? null,
    } : null,
  };
}

// A component: another glyph placed at (dx, dy) cells. Its position is this
// letter's own (each accented letter places its accent). What the letter
// erases of it is kept here too, in the component's own coordinates, so it
// moves with it: `erase` lists cells of its drawing, `hide` points on parts
// of its nodes or pieces (each point hides the part under it).
function cloneComponent(c) {
  const out = { glyph: c.glyph, dx: c.dx ?? 0, dy: c.dy ?? 0 };
  if (c.turn === 180) out.turn = 180;
  if (c.autoMirror) out.autoMirror = true;
  if (c.erase?.length) out.erase = [...c.erase];
  if (c.hide?.length) out.hide = c.hide.map(([x, y]) => [x, y]);
  return out;
}

export function componentPoint(font, comp, x, y) {
  if (comp.turn === 180) {
    const width = font.glyphs[comp.glyph]?.cols ?? 0;
    return [width - x + comp.dx, font.metrics.capHeight - y + comp.dy];
  }
  return [x + comp.dx, y + comp.dy];
}

export function componentCellFromParent(font, comp, c, r) {
  if (comp.turn === 180) {
    const width = font.glyphs[comp.glyph]?.cols ?? 0;
    return [width - c + comp.dx - 1, font.metrics.capHeight - r + comp.dy - 1];
  }
  return [c - comp.dx, r - comp.dy];
}

export function componentLocalPoint(font, comp, x, y) {
  if (comp.turn === 180) {
    const width = font.glyphs[comp.glyph]?.cols ?? 0;
    return [width - (x - comp.dx), font.metrics.capHeight - (y - comp.dy)];
  }
  return [x - comp.dx, y - comp.dy];
}

const transformedPiece = (font, comp, p) => {
  if (comp.turn !== 180) {
    return {
      ...p, x0: p.x0 + comp.dx, x1: p.x1 + comp.dx,
      y0: p.y0 + comp.dy, y1: p.y1 + comp.dy,
      ...(p.points ? { points: p.points.map(([x, y]) => [x + comp.dx, y + comp.dy]) } : {}),
    };
  }
  const point = (x, y) => componentPoint(font, comp, x, y);
  const [ax, ay] = point(p.x0, p.y0), [bx, by] = point(p.x1, p.y1);
  const corners = { bl: "tr", br: "tl", tl: "br", tr: "bl" };
  return {
    ...p, x0: Math.min(ax, bx), x1: Math.max(ax, bx),
    y0: Math.min(ay, by), y1: Math.max(ay, by),
    corner: corners[p.corner] ?? p.corner,
    ...(p.points ? { points: p.points.map(([x, y]) => point(x, y)) } : {}),
  };
};

// True if the letter erased part of the component.
export const componentEdited = (c) => !!(c.erase?.length || c.hide?.length);

// Empty glyph for a character of the set; accented letters start as
// base + accent composites, with the accent centered over the base.
export function defaultGlyph(font, char) {
  const cols = defaultCols(char);
  const space = char === " ";
  const glyph = createGlyph({
    cols, metrics: font.metrics,
    lsb: space ? 0 : font.cell, rsb: space ? 0 : font.cell,
  });
  const parts = COMPOSITES[char];
  if (parts) {
    const [base, accent] = parts;
    const baseCols = font.glyphs[base]?.cols ?? defaultCols(base);
    glyph.cols = baseCols;
    const accentCols = font.glyphs[accent]?.cols ?? defaultCols(accent);
    glyph.components = [
      { glyph: base, dx: 0, dy: 0 },
      { glyph: accent, dx: Math.floor((baseCols - accentCols) / 2), dy: 0 },
    ];
    // Once both are drawn, the accent's ink is centered on the letter's.
    glyph.components[1].dx = centeredDx(font, glyph, 1) ?? glyph.components[1].dx;
  }
  // A case mark starts as its accent raised from the x-height to the capitals.
  const mark = caseOf(char);
  if (mark) {
    const accent = font.glyphs[mark];
    glyph.cols = accent?.cols ?? defaultCols(mark);
    glyph.components = [{ glyph: mark, dx: 0, dy: caseLift(font) }];
  }
  const source = INVERTED_PUNCTUATION[char];
  if (source) {
    const base = font.glyphs[source] ?? defaultGlyph(font, source);
    glyph.cols = base.cols;
    glyph.lsb = base.lsb;
    glyph.rsb = base.rsb;
    glyph.components = [{ glyph: source, dx: 0, dy: invertedDrop(font), turn: 180, autoMirror: true }];
  }
  return glyph;
}

// ¡ and ¿ are ! and ? turned around, hanging from the x-height and going
// below the baseline, as usual in Spanish (turned in place, they would sit
// between the baseline and the cap height). In rows.
const invertedDrop = (font) => font.metrics.xHeight - font.metrics.capHeight;

// Version 3: fonts saved before still have ¡ and ¿ turned in place; those
// that weren't moved by hand now hang like new ones.
function hangInvertedSigns(font) {
  for (const [inverted, source] of Object.entries(INVERTED_PUNCTUATION)) {
    for (const comp of font.glyphs[inverted]?.components ?? []) {
      if (comp.autoMirror && comp.glyph === source && comp.dx === 0 && comp.dy === 0) comp.dy = invertedDrop(font);
    }
  }
}

// How far a case mark starts above its lowercase accent, in rows.
const caseLift = (font) => font.metrics.capHeight - font.metrics.xHeight;

// Makes sure every character of the set has a glyph.
export function ensureCharset(font) {
  const added = new Set();
  for (const char of CHARSET) {
    if (!font.glyphs[char]) {
      font.glyphs[char] = defaultGlyph(font, char);
      added.add(char);
    }
    // Older fonts may already contain empty inverted-sign glyphs. Link those
    // to their upright counterpart while preserving any hand-drawn inverted sign.
    const glyph = font.glyphs[char];
    if (char === "!" || char === "?") {
      glyph.components = glyph.components.filter((part) =>
        !(part.glyph === "." && part.turn !== 180 && !part.erase && !part.hide));
    }
    const source = INVERTED_PUNCTUATION[char];
    if (source && !glyph.cells.length && !glyph.pieces.length && !glyph.outline?.length && !glyph.components.length) {
      const base = font.glyphs[source];
      if (base) {
        glyph.cols = base.cols;
        glyph.lsb = base.lsb;
        glyph.rsb = base.rsb;
        glyph.components = [{ glyph: source, dx: 0, dy: invertedDrop(font), turn: 180, autoMirror: true }];
      }
    }
  }
  useCaseMarks(font, added);
  syncInvertedGlyphs(font);
  syncAlternates(font);
  return font;
}

// Fonts from before case marks had their capitals use the lowercase accent,
// raised. When a case mark is new, those capitals switch to it, placed so
// they look exactly the same (accents with erased parts are left as they are).
function useCaseMarks(font, added) {
  for (const [char, [, mark]] of Object.entries(COMPOSITES)) {
    const accent = caseOf(mark);
    const glyph = font.glyphs[char];
    if (!accent || !added.has(mark) || added.has(char) || !glyph) continue;
    for (const comp of glyph.components) {
      if (comp.glyph !== accent || comp.turn === 180 || componentEdited(comp)) continue;
      comp.glyph = mark;
      comp.dy -= caseLift(font);
    }
  }
}

// Alternates share the sidebearings of their letter (and, when both bold
// masters are drawn by hand, those of the bold master too), so swapping in
// an alternate keeps the spacing of the text.
export function syncAlternates(font) {
  for (const [k, glyph] of Object.entries(font.glyphs)) {
    const base = font.glyphs[alternateOf(k)?.base];
    if (!base) continue;
    glyph.lsb = base.lsb;
    glyph.rsb = base.rsb;
    if (glyph.bold && !glyph.bold.auto && base.bold && !base.bold.auto) {
      glyph.bold.lsb = base.bold.lsb;
      glyph.bold.rsb = base.bold.rsb;
    }
  }
}

// The glyph whose sidebearings `key` uses: its letter, for an alternate.
export const spacingKey = (font, key) => {
  const base = alternateOf(key)?.base;
  return base && font.glyphs[base] ? base : key;
};

export function syncInvertedGlyphs(font) {
  for (const [inverted, source] of Object.entries(INVERTED_PUNCTUATION)) {
    const glyph = font.glyphs[inverted], base = font.glyphs[source];
    if (!glyph || !base || !glyph.components.some((part) => part.autoMirror && part.glyph === source)) continue;
    glyph.cols = base.cols;
    glyph.lsb = base.lsb;
    glyph.rsb = base.rsb;
    glyph.grid = base.grid;
    glyph.curve = base.curve;
    glyph.rounding = base.rounding;
  }
}

export function createFont() {
  return {
    format: FORMAT,
    version: VERSION,
    meta: { family: "Letras Experimentales", style: "Regular", designer: "", version: "1.000" },
    upm: 1000,
    cell: 50,
    metrics: { ...DEFAULT_METRICS },
    overshoot: 12,
    // Grid type: "circles" (stars between circles) or "squares" (dot grid).
    grid: "circles",
    curve: 1,
    join: { enabled: true, width: 15 },
    // Square grid: corner rounding (0–1), fill or outline, outline width (u).
    rounding: 0.3,
    roundAll: false,
    style: "fill",
    stroke: 12,
    view: {
      ink: DEFAULT_INK, paper: DEFAULT_PAPER, guides: true, metrics: true,
      mirrorH: false, mirrorV: false, mirrorAxis: "auto", background: "",
      // Reference letter in a system font behind the glyph, like Glyphs:
      // "empty" = only while the glyph is empty, "always", or "off".
      placeholder: "empty",
      gridOpacity: 1,
      test: { text: "hamburgefonstiv", size: 72, inverted: false },
    },
    kerning: {},
    // Kerning groups by side ({ left: { V: "V", W: "V" }, right: {…} }) and
    // the values between them ({ A: { V: -60 } }). See kernGroup.
    groups: { left: {}, right: {} },
    groupKerning: {},
    // "Solo mayúsculas": lowercase letters are typed as their capitals.
    allCaps: false,
    // Weight axis: Regular and bold master weights, and how much the
    // automatic bold master thickens (units per side). See masters.js.
    axis: { min: 400, max: 800, thicken: 20, contrast: 0.6 },
    active: "a",
    glyphs: { a: createGlyph({ cells: SAMPLE_A }) },
    drafts: [],
  };
}

export const createFullFont = () => ensureCharset(createFont());

// A new, empty font (no sample letter) for "Nueva tipografía".
export function createBlankFont({ family = "Nueva tipografía", grid = "circles" } = {}) {
  const font = createFont();
  font.glyphs = {};
  font.meta.family = family;
  font.grid = grid;
  return ensureCharset(font);
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
  return ensureCharset(font);
}

// Fills in anything missing so older or hand-edited projects still load.
export function normalizeFont(data) {
  if (!data || typeof data !== "object") return createFullFont();
  if (data.format !== FORMAT) return migrateV1(data);
  const base = createFont();
  const font = {
    ...base,
    ...data,
    meta: { ...base.meta, ...data.meta },
    metrics: { ...base.metrics, ...data.metrics },
    join: { ...base.join, ...data.join },
    view: { ...base.view, ...data.view, test: { ...base.view.test, ...data.view?.test } },
    kerning: { ...data.kerning },
    groups: { left: { ...data.groups?.left }, right: { ...data.groups?.right } },
    groupKerning: Object.fromEntries(Object.entries(data.groupKerning ?? {}).map(([a, row]) => [a, { ...row }])),
    axis: { ...base.axis, ...data.axis },
    glyphs: { ...data.glyphs },
    drafts: [...(data.drafts ?? [])],
  };
  // Fonts on the old default colors move to the new ones.
  if (OLD_DEFAULTS.ink.includes(String(font.view.ink).toLowerCase())) font.view.ink = DEFAULT_INK;
  if (OLD_DEFAULTS.paper.includes(String(font.view.paper).toLowerCase())) font.view.paper = DEFAULT_PAPER;
  const fix = (g) => createGlyph({ ...g, metrics: { ...font.metrics, ...g.metrics } });
  for (const k of Object.keys(font.glyphs)) font.glyphs[k] = fix(font.glyphs[k]);
  font.drafts = font.drafts.map(fix);
  ensureCharset(font);
  if ((data.version ?? 2) < 3) hangInvertedSigns(font);
  font.version = VERSION;
  if (!font.glyphs[font.active]) font.active = "a";
  return font;
}

export const GRIDS = { circles: "Círculos (estrellas)", squares: "Puntos (cuadrados)" };

export const glyphGrid = (font, glyph) => glyph.grid ?? font.grid;

export const glyphCurve = (font, glyph) => glyph.curve ?? font.curve;

// The global rounding only applies once "Redondear todas las esquinas" is
// on; a glyph's own rounding and single corners always apply.
export const glyphRounding = (font, glyph) => glyph.rounding ?? (font.roundAll ? font.rounding : 0);

// The shape setting that the "Curvatura" controls edit for this glyph's grid.
export const shapeKey = (font, glyph) => (glyphGrid(font, glyph) === "squares" ? "rounding" : "curve");

export const hasOwnShape = (font, glyph) => glyph[shapeKey(font, glyph)] != null;

// Everything needed to draw a glyph's cells.
export const glyphShape = (font, glyph) => ({
  grid: glyphGrid(font, glyph),
  curve: glyphCurve(font, glyph),
  rounding: glyphRounding(font, glyph),
  corners: resolvedCorners(font, glyph),
  pieces: resolvedPieces(font, glyph),
  outline: resolvedOutline(font, glyph),
});

// Components' pieces (shifted like their cells), then the glyph's own.
export function resolvedPieces(font, glyph, seen = new Set()) {
  const out = [];
  for (const comp of glyph.components) {
    const base = font.glyphs[comp.glyph];
    if (!base || seen.has(comp.glyph)) continue;
    for (const p of resolvedPieces(font, base, new Set([...seen, comp.glyph]))) {
      if (comp.hide?.length && p.mode !== "cut" && comp.hide.some((pt) => windingAt([pieceContour(p)], pt) !== 0)) continue;
      out.push(transformedPiece(font, comp, p));
    }
  }
  return [...out, ...(glyph.outline ? [] : glyph.pieces)];
}

// Own corner radii plus those of the components, shifted like their cells.
export function resolvedCorners(font, glyph, seen = new Set()) {
  const out = {};
  for (const comp of glyph.components) {
    const base = font.glyphs[comp.glyph];
    if (!base || seen.has(comp.glyph)) continue;
    const inner = resolvedCorners(font, base, new Set([...seen, comp.glyph]));
    for (const [k, r] of Object.entries(inner)) {
      const [x, y] = parseKey(k);
      const [tx, ty] = componentPoint(font, comp, x, y);
      out[key(tx, ty)] = r;
    }
  }
  return Object.assign(out, glyph.corners);
}

export const advanceWidth = (font, glyph) => glyph.lsb + glyph.cols * font.cell + glyph.rsb;

// Cells contributed by components, shifted by their offsets (recursive).
export function componentCells(font, glyph, seen = new Set()) {
  const out = new Set();
  for (const comp of glyph.components) {
    const base = font.glyphs[comp.glyph];
    if (!base || seen.has(comp.glyph)) continue;
    const inner = new Set([...seen, comp.glyph]);
    // A component edited with nodes brings its outline instead of cells.
    const own = base.outline ? [] : base.cells.filter((k) => parseKey(k)[0] < base.cols);
    const erased = new Set(comp.erase ?? []);
    const cells = [...own, ...componentCells(font, base, inner)].filter((k) => !erased.has(k));
    for (const k of cells) {
      const [c, r] = parseKey(k);
      const [tc, tr] = comp.turn === 180
        ? [font.glyphs[comp.glyph].cols - c - 1 + comp.dx, font.metrics.capHeight - r - 1 + comp.dy]
        : [c + comp.dx, r + comp.dy];
      out.add(key(tc, tr));
    }
  }
  return out;
}

// Own drawing plus components: what is rendered and exported.
export const resolvedCells = (font, glyph) =>
  [...new Set([...(glyph.outline ? [] : glyph.cells), ...componentCells(font, glyph)])];

// Node-edited outlines of the glyph and its components (shifted), if any.
export function resolvedOutline(font, glyph, seen = new Set()) {
  const out = glyph.outline ? cloneOutline(glyph.outline) : [];
  for (const comp of glyph.components) {
    const base = font.glyphs[comp.glyph];
    if (!base || seen.has(comp.glyph)) continue;
    const parts = visibleParts(resolvedOutline(font, base, new Set([...seen, comp.glyph])), comp.hide);
    if (comp.turn === 180) {
      out.push(...parts.map((contour) => ({
        ...contour,
        nodes: contour.nodes.map((n) => {
          const [x, y] = componentPoint(font, comp, n.x, n.y);
          const rotate = (v) => v && [-v[0], -v[1]];
          return { ...n, x, y, in: rotate(n.in), out: rotate(n.out) };
        }),
      })));
    } else out.push(...shiftOutline(parts, comp.dx, comp.dy));
  }
  return out;
}

// The outline without the shapes (an outer contour with its holes) that
// have a `hide` point in their ink.
function visibleParts(outline, hide = []) {
  if (!hide.length) return outline;
  const kept = outline.filter((c) => c.nodes.length >= 2);
  const cmds = outlineToCommands(kept);
  const hidden = new Set();
  for (const obj of contourObjects(cmds)) {
    if (hide.some((pt) => windingAt(obj.map((ci) => cmds[ci]), pt) !== 0)) obj.forEach((ci) => hidden.add(ci));
  }
  return kept.filter((_, ci) => !hidden.has(ci));
}

// Horizontal extent [left, right] of a glyph's ink in cells (its visible
// columns, components, pieces that add ink and nodes), or null if empty.
export function inkSpan(font, glyph) {
  const xs = [];
  const own = glyph.outline ? [] : glyph.cells;
  for (const k of own) {
    const [c] = parseKey(k);
    if (c >= 0 && c < glyph.cols) xs.push(c, c + 1);
  }
  for (const k of componentCells(font, glyph)) xs.push(parseKey(k)[0], parseKey(k)[0] + 1);
  for (const p of resolvedPieces(font, glyph)) if (p.mode !== "cut") xs.push(p.x0, p.x1, ...(p.points ?? []).map(([x]) => x));
  for (const contour of resolvedOutline(font, glyph)) for (const n of contour.nodes) xs.push(n.x);
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
}

// The dx (whole columns: the grid is modular) that centers component `index`
// of `glyph` on the ink of the rest of the letter, or null when either is
// empty or the component is turned. When the two widths differ by an odd
// number of columns, half a column can't be avoided; it goes to the left.
export function centeredDx(font, glyph, index) {
  const comp = glyph.components[index];
  const base = font.glyphs[comp?.glyph];
  if (!base || comp.turn === 180) return null;
  const rest = { ...glyph, components: glyph.components.filter((_, i) => i !== index) };
  const [a, b] = [inkSpan(font, rest), inkSpan(font, base)];
  if (!a || !b) return null;
  return Math.floor((a[0] + a[1] - b[0] - b[1]) / 2);
}

// True if `char`'s glyph uses `target` anywhere in its component tree.
export function dependsOn(font, char, target, seen = new Set()) {
  const glyph = font.glyphs[char];
  if (!glyph || seen.has(char)) return false;
  seen.add(char);
  return glyph.components.some((c) => c.glyph === target || dependsOn(font, c.glyph, target, seen));
}

export const canUseComponent = (font, char, source) =>
  source !== char && !!font.glyphs[source] && !dependsOn(font, source, char);

// Glyphs whose look changes when `char` changes (itself included).
export const dependents = (font, char) =>
  Object.keys(font.glyphs).filter((k) => k === char || dependsOn(font, k, char));

export const allGlyphs = (font) => [...Object.values(font.glyphs), ...font.drafts];

// --- Alternates ("a.alt1"…) ---

// Alternates of `base`, in order.
export const alternates = (font, base) =>
  Object.keys(font.glyphs)
    .filter((k) => alternateOf(k)?.base === base)
    .sort((a, b) => alternateOf(a).n - alternateOf(b).n);

// Every glyph of the font: the character set, then the alternates (in the
// order of their characters).
export function allChars(font) {
  const order = new Map(CHARSET.map((c, i) => [c, i]));
  const extra = Object.keys(font.glyphs).filter((k) => !order.has(k));
  const rank = (k) => {
    const alt = alternateOf(k);
    return alt ? [order.get(alt.base) ?? Infinity, alt.n] : [Infinity, 0];
  };
  extra.sort((a, b) => {
    const [ra, na] = rank(a), [rb, nb] = rank(b);
    return ra - rb || na - nb || (a < b ? -1 : 1);
  });
  return [...CHARSET.filter((c) => font.glyphs[c]), ...extra];
}

// --- All-caps fonts ("Solo mayúsculas") ---
// Like Glyphs' all-caps fonts: typing a lowercase letter shows its capital,
// so the caps need no Caps Lock. The lowercase glyphs stay in the project but
// aren't exported; each capital also takes its lowercase code point.

// The capital a key stands for in an all-caps font, or null.
export function capitalOf(font, key) {
  if (!font.allCaps) return null;
  const char = alternateOf(key)?.base ?? key;
  const up = char.toUpperCase();
  return up !== char && font.glyphs[up] ? up : null;
}

// The glyphs that go into the font files.
export const exportChars = (font) => allChars(font).filter((k) => !capitalOf(font, k));

// Code points of a character in the font files: its own plus, in an all-caps
// font, those of the lowercase letters it stands for.
export function charUnicodes(font, char) {
  if (alternateOf(char) || caseOf(char)) return [];
  const extra = Object.keys(font.glyphs).filter((k) => !alternateOf(k) && capitalOf(font, k) === char);
  return [char, ...extra].map((c) => c.codePointAt(0));
}

// Adds an alternate of a character, starting as a copy of the drawing of
// `from` (the character or one of its alternates): cells, nodes, pieces,
// components, width and sidebearings. Returns its key.
export function addAlternate(font, from) {
  const base = alternateOf(from)?.base ?? from;
  const n = Math.max(0, ...alternates(font, base).map((k) => alternateOf(k).n)) + 1;
  const k = alternateKey(base, n);
  const src = font.glyphs[from];
  font.glyphs[k] = createGlyph(src ? JSON.parse(JSON.stringify(src)) : { metrics: font.metrics });
  return k;
}

// Deletes an alternate, and the components that used it.
export function removeAlternate(font, k) {
  if (!alternateOf(k) || !font.glyphs[k]) return;
  delete font.glyphs[k];
  for (const g of allGlyphs(font)) g.components = g.components.filter((c) => c.glyph !== k);
}

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

// --- Rows per zone ---
// The grid's height as rows in each zone between metric lines, from the top:
// above the capitals, between x-height and capitals, the x-height and below
// the baseline. Changing a zone inserts or removes rows there, so the lines
// above it move with it.
export const ROW_ZONES = [
  { key: "top", name: "Sobre las mayúsculas", min: 0 },
  { key: "caps", name: "De la x a las mayúsculas", min: 0 },
  { key: "x", name: "Altura de x", min: 1 },
  { key: "desc", name: "Bajo la línea base", min: 1 },
];

export const zoneRows = (m) => ({
  top: m.ascender - m.capHeight,
  caps: m.capHeight - m.xHeight,
  x: m.xHeight,
  desc: -m.descender,
});

export function setZoneRows(metrics, zone, rows) {
  const z = zoneRows(metrics);
  const def = ROW_ZONES.find((d) => d.key === zone);
  if (!def) return { ...metrics };
  // Same limits as setMetric: up to 60 rows above the baseline, 40 below.
  const above = z.top + z.caps + z.x;
  const max = zone === "desc" ? 40 : 60 - (above - z[zone]);
  z[zone] = clamp(Math.round(rows), def.min, max);
  const xHeight = z.x, capHeight = xHeight + z.caps, ascender = capHeight + z.top;
  return { ...metrics, descender: -z.desc, xHeight, capHeight, ascender };
}

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

// --- Spacing and kerning ---
// Kerning pairs are stored as two-character keys, e.g. "AV": -40 (units).
// Like Glyphs, letters can also share kerning through groups: each letter
// has a group on each side ("right" is used when it comes first, the A of
// AV; "left" when it comes second, the V). A value between two groups,
// stored in font.groupKerning[right group][left group], applies to every
// pair of their members; a pair with its own value is an exception.

export const pairKey = (left, right) => left + right;

export const GROUP_SIDES = ["left", "right"];

// The group of `key` on `side`: its own, else its letter's (an alternate
// follows its letter, an accented letter like Á follows A), else null.
export function kernGroup(font, key, side, seen = new Set()) {
  const own = font.groups?.[side]?.[key];
  if (own) return own;
  if (seen.has(key)) return null;
  seen.add(key);
  const base = alternateOf(key)?.base ?? (caseOf(key) ? null : COMPOSITES[key]?.[0]);
  return base && font.glyphs[base] ? kernGroup(font, base, side, seen) : null;
}

export function setKernGroup(font, key, side, name) {
  const n = String(name ?? "").trim().slice(0, 24);
  if (n) font.groups[side][key] = n;
  else delete font.groups[side][key];
}

// Every glyph in a group (its own or inherited), in the font's order.
export const groupMembers = (font, side, name) => allChars(font).filter((k) => kernGroup(font, k, side) === name);

// Names of the groups in use on a side.
export const groupNames = (font, side) => [...new Set(Object.values(font.groups[side]))].sort();

// The pair's own value, if it has one (alternates use their letter's).
export function pairKerning(font, left, right) {
  const base = (k) => alternateOf(k)?.base ?? k;
  for (const l of new Set([left, base(left)])) {
    for (const r of new Set([right, base(right)])) {
      const v = font.kerning[pairKey(l, r)];
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

// The groups a pair kerns with ([right group of left, left group of right]),
// or null unless both letters have one.
export function pairGroups(font, left, right) {
  const a = kernGroup(font, left, "right"), b = kernGroup(font, right, "left");
  return a && b ? [a, b] : null;
}

export const groupKerningValue = (font, a, b) => font.groupKerning[a]?.[b];

export function kerningValue(font, left, right) {
  const own = pairKerning(font, left, right);
  if (own !== undefined) return own;
  const groups = pairGroups(font, left, right);
  return (groups && groupKerningValue(font, ...groups)) ?? 0;
}

// What editing a pair changes: its own value when it has one (an
// exception), else its groups' value when both letters have groups.
export const kerningTarget = (font, left, right) =>
  font.kerning[pairKey(left, right)] === undefined && pairGroups(font, left, right) ? "group" : "pair";

// Sets the pair's own value. A 0 is kept while the pair's groups have a
// value, as an exception that cancels it.
export function setKerning(font, left, right, value) {
  const k = pairKey(left, right);
  const v = Math.round(value);
  const groups = pairGroups(font, left, right);
  if (v === 0 && !(groups && groupKerningValue(font, ...groups))) delete font.kerning[k];
  else font.kerning[k] = v;
}

export const removeKerning = (font, left, right) => { delete font.kerning[pairKey(left, right)]; };

export function setGroupKerning(font, a, b, value) {
  const v = Math.round(value);
  if (v) (font.groupKerning[a] ??= {})[b] = v;
  else if (font.groupKerning[a]) {
    delete font.groupKerning[a][b];
    if (!Object.keys(font.groupKerning[a]).length) delete font.groupKerning[a];
  }
}

// Kerning pairs for the font files, as [left, right, value] glyph keys:
// group values become pairs of their members, and a letter's pairs also
// apply to its alternates, on either side.
export function kerningPairs(font) {
  const keys = allChars(font);
  const family = (char) => [char, ...alternates(font, char)];
  const candidates = new Map();
  const add = (l, r) => candidates.set(`${l}\u0000${r}`, [l, r]);
  for (const pair of Object.keys(font.kerning)) {
    const [left, right] = [...pair];
    for (const l of family(left)) for (const r of family(right)) add(l, r);
  }
  const bySide = (side) => {
    const out = new Map();
    for (const k of keys) {
      const g = kernGroup(font, k, side);
      if (g) out.set(g, [...(out.get(g) ?? []), k]);
    }
    return out;
  };
  const rights = bySide("right"), lefts = bySide("left");
  for (const [a, row] of Object.entries(font.groupKerning)) {
    for (const b of Object.keys(row)) {
      for (const l of rights.get(a) ?? []) for (const r of lefts.get(b) ?? []) add(l, r);
    }
  }
  const out = [];
  for (const [l, r] of candidates.values()) {
    const v = Math.round(kerningValue(font, l, r));
    if (v) out.push([l, r, v]);
  }
  return out;
}

// Characters outside the set are shown as an empty box this wide.
export const missingAdvance = (font) => Math.round(font.upm / 2);

// Places each character of `text` using advance widths, sidebearings and
// kerning (in an all-caps font, lowercase letters are set as capitals). Returns one item per character: { char, line, index, x, advance,
// glyph, kern } where `kern` is the kerning applied after it.
// `advanceOf(char, glyph)` can give other widths (e.g. at another weight).
export function layoutText(font, text, advanceOf = null) {
  const items = [];
  const lines = text.split("\n");
  let width = 0;
  lines.forEach((line, li) => {
    const chars = [...line];
    let x = 0;
    chars.forEach((typed, i) => {
      const char = capitalOf(font, typed) ?? typed;
      const glyph = font.glyphs[char] ?? null;
      const advance = glyph ? (advanceOf ? advanceOf(char, glyph) : advanceWidth(font, glyph)) : missingAdvance(font);
      const next = chars[i + 1];
      const kern = next !== undefined ? kerningValue(font, char, capitalOf(font, next) ?? next) : 0;
      items.push({ char, line: li, index: i, x, advance, glyph, kern });
      x += advance + kern;
    });
    width = Math.max(width, x);
  });
  return { items, lines: lines.length, width };
}
