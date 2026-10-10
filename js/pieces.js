// "Piezas": geometric pieces placed over the square grid, which add ink or
// cut it away. Each piece fills a rectangle between two lattice points and
// is one of:
//   tri      – right triangle with its right angle at `corner` (diagonals)
//   quarter  – quarter ellipse centred at `corner` (bowls, round arms)
//   spandrel – the bit between `corner` and a quarter ellipse centred at the
//              opposite corner (cutting it rounds a corner with any radii)
//   poly     – any polygon joining grid points, kept in `points`
//   ellipse  – the ellipse inscribed in the box (round dots and counters)
//   pill     – a capsule: the box with its short ends fully round (slits
//              and rounded strokes, like the counters of a bubbly display
//              face); `corner` means nothing for these two
// `corner` is "bl", "br", "tl" or "tr" (y up); `mode` is "add" or "cut".
// Pieces apply in order on top of the drawn cells.
//
// Booleans with curves are done with Clipper on finely flattened outlines
// (robust with the many coinciding edges of a grid), then every run of
// points that came from one source curve is turned back into that exact
// curve, so the result keeps real Bézier curves.

import ClipperLib from "./vendor/clipper.js";
import { squareContours, MAX_RADIUS } from "./outline.js";

export const PIECE_SHAPES = { tri: "Triángulo", quarter: "Cuarto de elipse", spandrel: "Esquina curva", ellipse: "Elipse", pill: "Cápsula", poly: "Polígono" };

const SCALE = 1e5;          // Clipper works in integers: 1 cell = 100 000
const STEP = 0.05;          // flattening step along curves, in cells
const K = 0.5522847498;     // cubic approximation of a quarter circle/ellipse

const corners = ({ x0, y0, x1, y1 }) => ({ bl: [x0, y0], br: [x1, y0], tl: [x0, y1], tr: [x1, y1] });
const OPPOSITE = { bl: "tr", br: "tl", tl: "br", tr: "bl" };

// A triangle whose nodes were moved by hand keeps them in `points`
// ([[x, y] × 3]); a polygon keeps three or more. Its box just wraps them.
const validPoints = (pts, any = false) =>
  Array.isArray(pts) && (any ? pts.length >= 3 : pts.length === 3) && pts.every((q) => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite));

// Twice the signed area of a polygon.
export const polygonArea = (pts) => pts.reduce((a, [x, y], i) => {
  const [nx, ny] = pts[(i + 1) % pts.length];
  return a + x * ny - nx * y;
}, 0);

export function normalizePiece(p) {
  const shape = PIECE_SHAPES[p.shape] ? p.shape : "tri";
  const out = {
    x0: Math.min(p.x0, p.x1), y0: Math.min(p.y0, p.y1),
    x1: Math.max(p.x0, p.x1), y1: Math.max(p.y0, p.y1),
    corner: OPPOSITE[p.corner] ? p.corner : "bl",
    shape,
    mode: p.mode === "cut" ? "cut" : "add",
  };
  if ((shape === "tri" && validPoints(p.points)) || (shape === "poly" && validPoints(p.points, true))) {
    out.points = p.points.map(([x, y]) => [x, y]);
    const xs = out.points.map((q) => q[0]), ys = out.points.map((q) => q[1]);
    Object.assign(out, { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
  }
  return out;
}

// Nodes that can be dragged: the three corners of a triangle; for curved
// pieces the corner C and both ends of the arc (A moves sideways, B up and
// down).
export function pieceHandles(piece) {
  const p = normalizePiece(piece);
  if (p.shape === "tri") return trianglePoints(p).map(([x, y], i) => ({ id: i, x, y }));
  if (p.shape === "poly") return (p.points ?? []).map(([x, y], i) => ({ id: i, x, y }));
  const box = corners(p);
  const C = box[p.corner], O = box[OPPOSITE[p.corner]];
  return [{ id: "C", x: C[0], y: C[1] }, { id: "A", x: O[0], y: C[1] }, { id: "B", x: C[0], y: O[1] }];
}

function trianglePoints(p) {
  if (p.points) return p.points;
  const box = corners(p);
  const C = box[p.corner], O = box[OPPOSITE[p.corner]];
  return [C, [O[0], C[1]], [C[0], O[1]]];
}

// A diagonal piece covers its box (around its three nodes) on the corner
// C's side of the diagonal A–B. Untouched, that is the right triangle C A B;
// with a node moved it still reaches the box edges, so moving an end of a
// diagonal never leaves a sliver of the edge behind.
export function diagonalPolygon([C, A, B]) {
  const xs = [C[0], A[0], B[0]], ys = [C[1], A[1], B[1]];
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const side = (P) => (B[0] - A[0]) * (P[1] - A[1]) - (B[1] - A[1]) * (P[0] - A[0]);
  const sign = Math.sign(side(C));
  const rect = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const out = [];
  rect.forEach((P, i) => {
    const Q = rect[(i + 1) % 4];
    const sp = side(P) * sign, sq = side(Q) * sign;
    if (sp >= -1e-12) out.push(P);
    if ((sp > 1e-12 && sq < -1e-12) || (sp < -1e-12 && sq > 1e-12)) {
      const t = sp / (sp - sq);
      out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]);
    }
  });
  return out;
}

// The piece with node `id` moved to (x, y). Returns null if the move would
// flatten it.
export function movePieceHandle(piece, id, [x, y]) {
  const p = normalizePiece(piece);
  if (p.shape === "poly") {
    if (!p.points) return null;
    const points = p.points.map((q) => [...q]);
    points[id] = [x, y];
    if (Math.abs(polygonArea(points)) < 1e-9) return null;
    return normalizePiece({ ...p, points });
  }
  if (p.shape === "tri") {
    const points = trianglePoints(p).map((q) => [...q]);
    points[id] = [x, y];
    const [[cx, cy], [ax, ay], [bx, by]] = points;
    if (Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) < 1e-9) return null;
    return normalizePiece({ ...p, points });
  }
  const box = corners(p);
  let C = box[p.corner], O = box[OPPOSITE[p.corner]];
  if (id === "C") C = [x, y];
  if (id === "A") O = [x, O[1]];
  if (id === "B") O = [O[0], y];
  if (C[0] === O[0] || C[1] === O[1]) return null;
  return normalizePiece({
    ...p, x0: C[0], y0: C[1], x1: O[0], y1: O[1],
    corner: (C[1] < O[1] ? "b" : "t") + (C[0] < O[0] ? "l" : "r"),
  });
}

// The piece outline as commands, in cells (y up).
export function pieceContour(piece) {
  const p = normalizePiece(piece);
  const box = corners(p);
  const C = box[p.corner], O = box[OPPOSITE[p.corner]];
  // The two other corners: A shares C's y, B shares C's x.
  const A = [O[0], C[1]], B = [C[0], O[1]];
  const M = (pt) => ({ type: "M", x: pt[0], y: pt[1] });
  const L = (pt) => ({ type: "L", x: pt[0], y: pt[1] });
  if (p.shape === "poly") {
    const pts = p.points ?? [];
    if (pts.length < 3) return [M([p.x0, p.y0]), { type: "Z" }];
    return [M(pts[0]), ...pts.slice(1).map(L), { type: "Z" }];
  }
  // Quarter ellipse from P0 to P3 around `center`.
  const arc = (center, P0, P3) => ({
    type: "C",
    x1: P0[0] + K * (P3[0] - center[0]), y1: P0[1] + K * (P3[1] - center[1]),
    x2: P3[0] + K * (P0[0] - center[0]), y2: P3[1] + K * (P0[1] - center[1]),
    x: P3[0], y: P3[1],
  });
  if (p.shape === "tri") {
    const poly = diagonalPolygon(trianglePoints(p));
    return [M(poly[0]), ...poly.slice(1).map(L), { type: "Z" }];
  }
  if (p.shape === "quarter") return [M(C), L(A), arc(C, A, B), { type: "Z" }];
  if (p.shape === "ellipse" || p.shape === "pill") return roundBox(p, M, L, arc);
  return [M(C), L(A), arc(O, A, B), { type: "Z" }]; // spandrel
}

// An ellipse filling the box, or a capsule: the box with half circles on
// its short sides (a circle when the box is square). Counter-clockwise from
// the bottom, whatever the piece's corner, so turning one changes nothing.
function roundBox({ x0, y0, x1, y1, shape }, M, L, arc) {
  const w = x1 - x0, h = y1 - y0;
  // Ellipse: radii are the half sizes; capsule: half the short side.
  const r = shape === "pill" ? Math.min(w, h) / 2 : null;
  const rx = r ?? w / 2, ry = r ?? h / 2;
  // Centres of the four corner arcs and where their straight sides start.
  const L0 = x0 + rx, R0 = x1 - rx, B0 = y0 + ry, T0 = y1 - ry;
  const cmds = [M([L0, y0])];
  const side = (from, to) => { if (Math.hypot(to[0] - from[0], to[1] - from[1]) > 1e-12) cmds.push(L(to)); };
  side([L0, y0], [R0, y0]);
  cmds.push(arc([R0, B0], [R0, y0], [x1, B0]));
  side([x1, B0], [x1, T0]);
  cmds.push(arc([R0, T0], [x1, T0], [R0, y1]));
  side([R0, y1], [L0, y1]);
  cmds.push(arc([L0, T0], [L0, y1], [x0, T0]));
  side([x0, T0], [x0, B0]);
  cmds.push(arc([L0, B0], [x0, B0], [L0, y0]));
  cmds.push({ type: "Z" });
  return cmds;
}

// Square-grid glyph: drawn cells plus pieces, as a filled shape or, with
// `stroke`, as an outline. With pieces, corners are rounded at the end, on
// the final shape, so diagonal corners can be rounded too and a rounding
// never sits where a piece has moved the outline.
export function squareGlyphContours(cells, { rounding = 0, corners: cornerRadii = {}, stroke = 0, pieces = [] }) {
  if (!pieces.length) return squareContours(cells, { rounding, corners: cornerRadii, stroke });
  const { book, shape: raw } = buildShape(cells, pieces, cornerRadii);
  // As an outline, cells touching at a corner stay apart (like without pieces).
  let shape = roundCorners(book, raw, findCorners(book, raw), rounding / 2, cornerRadii, stroke === 0).shape;
  if (stroke > 0) {
    // As an outline: the shape minus a copy inset by the stroke.
    const off = new ClipperLib.ClipperOffset(2, 0.001 * SCALE);
    off.AddPaths(shape, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    const inset = new ClipperLib.Paths();
    off.Execute(inset, -stroke * SCALE);
    shape = clipperOp(ClipperLib.ClipType.ctDifference, shape, inset);
  }
  return shape.map((path) => book.refit(path));
}

// Corners of a glyph with pieces (where two straight edges meet), for the
// corner tool: { key, x, y, turn } with turn 1 outer, 3 inner. `radii`
// holds the radius each one really gets.
export function pieceGlyphCorners(cells, { rounding = 0, corners: cornerRadii = {}, pieces = [] }) {
  const { book, shape, hidden } = buildShape(cells, pieces, cornerRadii);
  const { radii, corners } = roundCorners(book, shape, findCorners(book, shape), rounding / 2, cornerRadii);
  return [
    ...corners.map((c, i) => ({ key: c.key, x: c.x, y: c.y, turn: c.turn, din: c.a, dout: c.b, radius: radii[i] })),
    ...hidden,
  ];
}

function buildShape(cells, pieces, cornerRadii = {}) {
  const book = new CurveBook();
  return { book, ...piecesOn(book, book.paths(squareContours(cells, { rounding: 0 })), pieces, cornerRadii) };
}

// Pieces on top of a drawing. Corners are rounded on the final shape, but a
// rounded corner of a piece that the union swallows (two figures pushed
// together, so the point ends up on a straight edge) would lose its
// rounding: those pieces are rounded on their own before they are joined,
// as in Illustrator. `hidden` lists those corners, for the corner tool.
function piecesOn(book, base, pieces, cornerRadii) {
  const shape = applyPieces(book, base, pieces);
  const rounded = Object.keys(cornerRadii).filter((k) => cornerRadii[k] === "max" || +cornerRadii[k] > 0);
  if (!rounded.length) return { shape, hidden: [] };
  const present = new Set(findCorners(book, shape).map((c) => c.key));
  const swallowed = new Set(rounded.filter((k) => !present.has(k)));
  if (!swallowed.size) return { shape, hidden: [] };
  const hidden = new Map();
  const own = (clip) => {
    const found = findCorners(book, clip).filter((c) => swallowed.has(c.key));
    if (!found.length) return clip;
    const { shape: done, radii, corners } = roundCorners(book, clip, found, 0, cornerRadii);
    corners.forEach((c, i) => hidden.set(c.key, { key: c.key, x: c.x, y: c.y, turn: c.turn, din: c.a, dout: c.b, radius: radii[i] }));
    return done;
  };
  return { shape: applyPieces(book, base, pieces, own), hidden: [...hidden.values()] };
}

// Any grid drawing (like the stars of the circle grid) with pieces on top,
// cleaned of overlaps, curves kept. `corners` rounds the corners the pieces
// make (radius per corner key), as the corner tool does on squares.
export function contoursWithPieces(contours, pieces, { corners: cornerRadii = {} } = {}) {
  const book = new CurveBook();
  let { shape } = piecesOn(book, unionPaths(book.paths(contours)), pieces, cornerRadii);
  if (Object.keys(cornerRadii).length) shape = roundCorners(book, shape, findCorners(book, shape), 0, cornerRadii).shape;
  return shape.map((path) => book.refit(path));
}

function applyPieces(book, shape, pieces, own = (clip) => clip) {
  for (const piece of pieces) {
    let clip = orient(book.paths([pieceContour(piece)])).filter((q) => Math.abs(ClipperLib.Clipper.Area(q)) > 1);
    if (!clip.length) continue;
    clip = own(clip);
    shape = clipperOp(piece.mode === "cut" ? ClipperLib.ClipType.ctDifference : ClipperLib.ClipType.ctUnion, shape, clip);
  }
  return shape;
}

// Corner positions are keyed like lattice points ("3,14"), with up to three
// decimals for corners that pieces put between grid points.
export const cornerKey = (x, y) => {
  const f = (v) => String(Math.round(v * 1000) / 1000);
  return `${f(x)},${f(y)}`;
};

// Vertices of the shape where two straight edges meet at an angle.
function findCorners(book, shape) {
  const found = [];
  shape.forEach((path, pi) => {
    const n = path.length;
    for (let i = 0; i < n; i++) {
      const P = path[(i - 1 + n) % n], V = path[i], Q = path[(i + 1) % n];
      if (book.edgeCurve(P, V) || book.edgeCurve(V, Q)) continue;
      const ax = V.X - P.X, ay = V.Y - P.Y, bx = Q.X - V.X, by = Q.Y - V.Y;
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (!la || !lb) continue;
      const cross = (ax * by - ay * bx) / (la * lb), dot = (ax * bx + ay * by) / (la * lb);
      if (Math.abs(cross) < 1e-3 && dot > 0) continue; // straight on
      const x = V.X / SCALE, y = V.Y / SCALE;
      found.push({
        path: pi, index: i, x, y, key: cornerKey(x, y),
        // Ink is on the left of every path, so a left turn is an outer corner.
        turn: cross > 0 ? 1 : 3,
        a: [ax / la, ay / la], b: [bx / lb, by / lb], la: la / SCALE, lb: lb / SCALE,
        // Neighbouring corners on the same edges share their length.
        prevCorner: !book.edgeCurve(path[(i - 2 + n) % n], P), nextCorner: !book.edgeCurve(Q, path[(i + 2) % n]),
      });
    }
  });
  return found;
}

// Rounds corners with fillets: an outer corner loses the bit between the
// corner and the arc, an inner one gains it. A radius is shrunk until that
// bit is all ink (outer) or all empty (inner), so it never eats a counter or
// fills another part of the letter.
function roundCorners(book, shape, found, base, wanted, join = true) {
  const want = found.map((c) => {
    const w = wanted[c.key];
    const r = w === undefined ? base : w === "max" ? MAX_RADIUS : +w || 0;
    return Math.min(Math.max(r, 0), MAX_RADIUS);
  });
  if (join) found = joinTouchingCorners(shape, found, want);
  // Distance from the corner to where the arc starts, per unit of radius.
  const per = found.map((c) => {
    const cos = Math.min(1, Math.max(-1, c.a[0] * c.b[0] + c.a[1] * c.b[1]));
    return Math.tan(Math.acos(cos) / 2);
  });
  let d = want.map((r, i) => r * per[i]);
  // Never past the edges; corners on the same edge share it.
  found.forEach((c, i) => {
    d[i] = Math.min(d[i], c.prevCorner ? Infinity : c.la, c.nextCorner ? Infinity : c.lb);
  });
  const byPos = new Map(found.map((c, i) => [`${c.path}:${c.index}`, i]));
  for (let pass = 0; pass < 2; pass++) {
    found.forEach((c, i) => {
      const j = byPos.get(c.next ?? `${c.path}:${(c.index + 1) % shape[c.path].length}`);
      if (j === undefined) return;
      const L = c.lb;
      if (d[i] + d[j] <= L + 1e-9) return;
      if (d[i] >= L / 2 && d[j] >= L / 2) d[i] = d[j] = L / 2;
      else if (d[i] > d[j]) d[i] = L - d[j];
      else d[j] = L - d[i];
    });
  }
  const radii = d.map((dist, i) => (per[i] > 1e-9 ? dist / per[i] : 0));

  const outer = [], inner = [];
  found.forEach((c, i) => {
    if (radii[i] < 1e-6) return;
    const fits = (r) => {
      const region = orient(book.paths([fillet(c, r, per[i])]));
      const test = c.turn === 1
        ? clipperOp(ClipperLib.ClipType.ctDifference, region, shape)
        : clipperOp(ClipperLib.ClipType.ctIntersection, region, shape);
      return test.reduce((sum, p) => sum + Math.abs(ClipperLib.Clipper.Area(p)), 0) < 1e-9 * SCALE * SCALE;
    };
    if (!fits(radii[i])) {
      let lo = 0, hi = radii[i];
      for (let k = 0; k < 16; k++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid; else hi = mid;
      }
      // A hair short of touching, so a wall never ends at zero thickness.
      radii[i] = Math.max(0, lo - 0.01);
    }
    if (radii[i] < 1e-6) return;
    (c.turn === 1 ? outer : inner).push(...orient(book.paths([fillet(c, radii[i], per[i])])));
  });
  let rounded = shape;
  if (outer.length) rounded = clipperOp(ClipperLib.ClipType.ctDifference, rounded, outer);
  if (inner.length) rounded = clipperOp(ClipperLib.ClipType.ctUnion, rounded, inner);
  return { shape: rounded, radii, corners: found };
}

// Two cells touching only at a corner leave two outer corners on the same
// point, facing opposite ways. When that point is rounded they are joined
// instead: the outline runs from one cell into the other, turning into two
// inner corners whose fillets make a neck between the cells (as on squares
// without pieces). Each new corner keeps its incoming edge and takes the
// other one's outgoing edge.
function joinTouchingCorners(shape, found, want) {
  const out = found.slice();
  const opposite = (u, v) => Math.abs(u[0] + v[0]) < 1e-6 && Math.abs(u[1] + v[1]) < 1e-6;
  const nextOf = (c) => `${c.path}:${(c.index + 1) % shape[c.path].length}`;
  for (let i = 0; i < found.length; i++) {
    const c = found[i];
    if (c.turn !== 1 || want[i] <= 0 || out[i] !== c) continue;
    for (let j = i + 1; j < found.length; j++) {
      const d = found[j];
      if (d.turn !== 1 || d.key !== c.key || out[j] !== d || !opposite(c.a, d.a) || !opposite(c.b, d.b)) continue;
      out[i] = { ...c, turn: 3, b: d.b, lb: d.lb, nextCorner: d.nextCorner, next: nextOf(d) };
      out[j] = { ...d, turn: 3, b: c.b, lb: c.lb, nextCorner: c.nextCorner, next: nextOf(c) };
      break;
    }
  }
  return out;
}

// The bit between a corner and its fillet arc of radius r, as a contour.
function fillet(c, r, per) {
  const d = r * per;
  const V = [c.x, c.y];
  const T1 = [V[0] - d * c.a[0], V[1] - d * c.a[1]];
  const T2 = [V[0] + d * c.b[0], V[1] + d * c.b[1]];
  const turn = Math.acos(Math.min(1, Math.max(-1, c.a[0] * c.b[0] + c.a[1] * c.b[1])));
  // One cubic per half of the arc keeps it accurate for sharp corners.
  const side = c.turn === 1 ? 1 : -1;
  const center = [T1[0] - side * c.a[1] * r, T1[1] + side * c.a[0] * r];
  const angle = (p) => Math.atan2(p[1] - center[1], p[0] - center[0]);
  const a0 = angle(T1);
  const sweep = side * turn;
  const cmds = [{ type: "M", x: V[0], y: V[1] }, { type: "L", x: T1[0], y: T1[1] }];
  const parts = turn > Math.PI / 2 ? 2 : 1;
  for (let k = 0; k < parts; k++) {
    const s0 = a0 + (sweep * k) / parts, s1 = a0 + (sweep * (k + 1)) / parts;
    const kk = (4 / 3) * Math.tan((s1 - s0) / 4) * r;
    const p0 = [center[0] + r * Math.cos(s0), center[1] + r * Math.sin(s0)];
    const p3 = [center[0] + r * Math.cos(s1), center[1] + r * Math.sin(s1)];
    cmds.push({
      type: "C",
      x1: p0[0] - kk * Math.sin(s0), y1: p0[1] + kk * Math.cos(s0),
      x2: p3[0] + kk * Math.sin(s1), y2: p3[1] - kk * Math.cos(s1),
      x: k === parts - 1 ? T2[0] : p3[0], y: k === parts - 1 ? T2[1] : p3[1],
    });
  }
  cmds.push({ type: "Z" });
  return cmds;
}

function clipperOp(type, subject, clip) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const out = new ClipperLib.Paths();
  c.Execute(type, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return openTouchingHoles(out);
}

// Clipper leaves a cut that reaches the edge of the shape exactly (a wedge
// whose side lies on the outline) as a hole touching the outline along that
// side, instead of a notch. Two contours running along the same stretch in
// opposite directions are joined there into one, which opens the notch.
export function openTouchingHoles(paths) {
  const out = paths.map((p) => p.slice());
  let merged = true;
  while (merged) {
    merged = false;
    search:
    for (let a = 0; a < out.length; a++) {
      for (let b = 0; b < out.length; b++) {
        if (a === b) continue;
        const joined = joinAlongSharedEdge(out[a], out[b]);
        if (joined) {
          out[a] = joined;
          out.splice(b, 1);
          merged = true;
          break search;
        }
      }
    }
  }
  return out.filter((p) => p.length >= 3);
}

function joinAlongSharedEdge(A, B) {
  const TOL = 2; // Clipper units (1 cell = 100 000)
  for (let i = 0; i < A.length; i++) {
    const P = A[i], Q = A[(i + 1) % A.length];
    const dx = Q.X - P.X, dy = Q.Y - P.Y, len = Math.hypot(dx, dy);
    if (len < TOL) continue;
    const off = (V) => Math.abs(dx * (V.Y - P.Y) - dy * (V.X - P.X)) / len;
    const along = (V) => ((V.X - P.X) * dx + (V.Y - P.Y) * dy) / (len * len);
    for (let j = 0; j < B.length; j++) {
      const R = B[j], S = B[(j + 1) % B.length];
      if (off(R) > TOL || off(S) > TOL) continue;
      if ((S.X - R.X) * dx + (S.Y - R.Y) * dy >= 0) continue; // same direction
      const t0 = Math.max(0, along(S)), t1 = Math.min(1, along(R));
      if ((t1 - t0) * len < TOL) continue;
      const at = (t) => ({ X: Math.round(P.X + dx * t), Y: Math.round(P.Y + dy * t) });
      // A up to P, along the shared edge to where it starts, round B (from
      // S back to R), then on to Q.
      const path = [...A.slice(0, i + 1), at(t0)];
      for (let k = 1; k <= B.length; k++) path.push(B[(j + k) % B.length]);
      path.push(at(t1), ...A.slice(i + 1));
      return dedupe(path);
    }
  }
  return null;
}

function dedupe(path) {
  const out = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (!last || last.X !== p.X || last.Y !== p.Y) out.push(p);
  }
  while (out.length > 1 && out[0].X === out[out.length - 1].X && out[0].Y === out[out.length - 1].Y) out.pop();
  return out;
}

// Pieces are added with a positive orientation so nonzero filling works.
function orient(paths) {
  return paths.map((p) => (ClipperLib.Clipper.Orientation(p) ? p : p.slice().reverse()));
}

// Flattens contours for Clipper while remembering which curve (and where on
// it) every sample came from, so the curves can be rebuilt afterwards.
class CurveBook {
  constructor() {
    this.curves = [];        // [{ p0, p1, p2, p3, samples: [{ X, Y, t }] }]
    this.at = new Map();     // "X,Y" -> [{ curve, index }]
  }

  paths(contours) {
    const out = [];
    for (const cmds of contours) {
      const path = [];
      let cur = null;
      const push = (X, Y) => {
        const last = path[path.length - 1];
        if (!last || last.X !== X || last.Y !== Y) path.push({ X, Y });
      };
      for (const c of cmds) {
        if (c.type === "M" || c.type === "L") {
          cur = [c.x, c.y];
          push(Math.round(c.x * SCALE), Math.round(c.y * SCALE));
        } else if (c.type === "C") {
          const curve = { p0: cur, p1: [c.x1, c.y1], p2: [c.x2, c.y2], p3: [c.x, c.y], samples: [] };
          const id = this.curves.push(curve) - 1;
          const n = Math.max(4, Math.min(600, Math.ceil(curveLength(curve) / STEP)));
          for (let i = 0; i <= n; i++) {
            const t = i / n;
            const [x, y] = bezier(curve, t);
            const X = Math.round(x * SCALE), Y = Math.round(y * SCALE);
            curve.samples.push({ X, Y, t });
            const k = `${X},${Y}`;
            if (!this.at.has(k)) this.at.set(k, []);
            this.at.get(k).push({ curve: id, index: curve.samples.length - 1 });
            if (i > 0) push(X, Y);
          }
          cur = [c.x, c.y];
        }
      }
      if (path.length > 2) {
        const a = path[0], b = path[path.length - 1];
        if (a.X === b.X && a.Y === b.Y) path.pop();
        out.push(path);
      }
    }
    return out;
  }

  // Where point P sits on curve `id` near sample `index` (it may be a new
  // intersection point on a chord): its t, or null if it is not there.
  locate(id, index, P) {
    const s = this.curves[id].samples;
    for (const j of [index - 1, index]) {
      if (j < 0 || j + 1 >= s.length) continue;
      const a = s[j], b = s[j + 1];
      const dx = b.X - a.X, dy = b.Y - a.Y, len2 = dx * dx + dy * dy;
      if (!len2) continue;
      const u = ((P.X - a.X) * dx + (P.Y - a.Y) * dy) / len2;
      const dist = Math.abs((P.X - a.X) * dy - (P.Y - a.Y) * dx) / Math.sqrt(len2);
      if (u >= -1e-9 && u <= 1 + 1e-9 && dist < 2) return a.t + (b.t - a.t) * u;
    }
    return null;
  }

  // The curve an edge PQ runs along, with the t of both ends.
  edgeCurve(P, Q) {
    const ps = this.at.get(`${P.X},${P.Y}`) ?? [], qs = this.at.get(`${Q.X},${Q.Y}`) ?? [];
    for (const a of ps) for (const b of qs) {
      if (a.curve !== b.curve || a.index === b.index) continue;
      const s = this.curves[a.curve].samples;
      // Clipper may drop samples that are exactly in line; anything else
      // joining two samples of the same curve (a chord) is a straight edge.
      if (Math.abs(a.index - b.index) > 1) {
        const m = s[(a.index + b.index) >> 1];
        const dx = Q.X - P.X, dy = Q.Y - P.Y;
        if (Math.abs((m.X - P.X) * dy - (m.Y - P.Y) * dx) / Math.hypot(dx, dy) > 2) continue;
      }
      return { curve: a.curve, ta: s[a.index].t, tb: s[b.index].t };
    }
    // One end is a new intersection point lying on the curve's chord.
    for (const a of ps) {
      const t = this.locate(a.curve, a.index, Q);
      const ta = this.curves[a.curve].samples[a.index].t;
      if (t !== null && t !== ta) return { curve: a.curve, ta, tb: t };
    }
    for (const b of qs) {
      const t = this.locate(b.curve, b.index, P);
      const tb = this.curves[b.curve].samples[b.index].t;
      if (t !== null && t !== tb) return { curve: b.curve, ta: t, tb };
    }
    return null;
  }

  // A Clipper path back to commands: straight edges stay lines and every run
  // of edges along one source curve becomes that curve's exact piece.
  refit(path) {
    const n = path.length;
    const edges = path.map((P, i) => this.edgeCurve(P, path[(i + 1) % n]));
    // Start where a run begins, so no run wraps around the start.
    let start = edges.findIndex((e, i) => !sameRun(edges[(i - 1 + n) % n], e));
    if (start < 0) start = 0;
    const pt = (P) => [P.X / SCALE, P.Y / SCALE];
    const cmds = [{ type: "M", x: path[start].X / SCALE, y: path[start].Y / SCALE }];
    for (let k = 0; k < n;) {
      const i = (start + k) % n;
      const e = edges[i];
      let len = 1;
      while (e && k + len < n && sameRun(edges[(start + k + len - 1) % n], edges[(start + k + len) % n])) len++;
      const end = path[(i + len) % n];
      if (!e) {
        cmds.push({ type: "L", x: end.X / SCALE, y: end.Y / SCALE });
      } else {
        const last = edges[(i + len - 1) % n];
        const [, c1, c2] = subCurve(this.curves[e.curve], e.ta, last.tb);
        const [x, y] = pt(end);
        cmds.push({ type: "C", x1: c1[0], y1: c1[1], x2: c2[0], y2: c2[1], x, y });
      }
      k += len;
    }
    // The last straight edge back to the start is implied by closing.
    const last = cmds[cmds.length - 1];
    if (last.type === "L" && last.x === cmds[0].x && last.y === cmds[0].y) cmds.pop();
    cmds.push({ type: "Z" });
    return cmds;
  }
}

const sameRun = (a, b) => !!a && !!b && a.curve === b.curve && Math.sign(a.tb - a.ta) === Math.sign(b.tb - b.ta) && Math.abs(a.tb - b.ta) < 1e-9;

function bezier({ p0, p1, p2, p3 }, t) {
  const u = 1 - t;
  return [0, 1].map((i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]);
}

function curveLength(c) {
  let len = 0, prev = c.p0;
  for (let i = 1; i <= 16; i++) {
    const p = bezier(c, i / 16);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return len;
}

// Control points of the part of a cubic between t = a and t = b.
function subCurve(c, a, b) {
  if (a > b) return subCurve(c, b, a).reverse();
  const split = (pts, t) => {
    const lerp = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const [p0, p1, p2, p3] = pts;
    const q0 = lerp(p0, p1), q1 = lerp(p1, p2), q2 = lerp(p2, p3);
    const r0 = lerp(q0, q1), r1 = lerp(q1, q2), s = lerp(r0, r1);
    return [[p0, q0, r0, s], [s, r1, q2, p3]];
  };
  const whole = [c.p0, c.p1, c.p2, c.p3];
  const [, right] = split(whole, a);
  const [mid] = split(right, a >= 1 ? 0 : (b - a) / (1 - a));
  return mid;
}

// Mirror images of a piece (for the mirror tools).
export function mirrorPiece(p, { h = null, v = null } = {}) {
  let q = { ...p };
  if (h !== null) {
    q = { ...q, x0: h - q.x1, x1: h - q.x0, corner: q.corner[0] + (q.corner[1] === "l" ? "r" : "l") };
    if (q.points) q.points = q.points.map(([x, y]) => [h - x, y]);
  }
  if (v !== null) {
    q = { ...q, y0: v - q.y1, y1: v - q.y0, corner: (q.corner[0] === "b" ? "t" : "b") + q.corner[1] };
    if (q.points) q.points = q.points.map(([x, y]) => [x, v - y]);
  }
  return q;
}

// Merges contours that may overlap (hand-edited outlines, components) into
// clean ones: no overlaps, outer contours counter-clockwise, curves kept.
export function unionContours(contours) {
  const book = new CurveBook();
  const paths = book.paths(contours);
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const out = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctUnion, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out.map((path) => book.refit(path));
}

// --- Outlines edited with nodes: live corners and the pathfinder ---

function unionPaths(paths) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const out = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctUnion, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return openTouchingHoles(out);
}

// Any contours with rounded corners on top (radius per corner key, plus
// the global `rounding`), cleaned of overlaps. Used for node outlines, so
// rounding stays live while the nodes keep their sharp positions.
export function roundedContours(contours, { rounding = 0, corners: cornerRadii = {} } = {}) {
  const book = new CurveBook();
  const shape = unionPaths(book.paths(contours));
  const rounded = Object.keys(cornerRadii).length || rounding > 0
    ? roundCorners(book, shape, findCorners(book, shape), rounding / 2, cornerRadii).shape
    : shape;
  return rounded.map((path) => book.refit(path));
}

// Corners of any contours, for the corner tool (like pieceGlyphCorners).
export function contourCorners(contours, { rounding = 0, corners: cornerRadii = {} } = {}) {
  const book = new CurveBook();
  const shape = unionPaths(book.paths(contours));
  const { radii, corners } = roundCorners(book, shape, findCorners(book, shape), rounding / 2, cornerRadii);
  return corners.map((c, i) => ({ key: c.key, x: c.x, y: c.y, turn: c.turn, din: c.a, dout: c.b, radius: radii[i] }));
}

// Groups contours into objects, like shapes in Illustrator: each outer
// contour with the holes inside it. Returns lists of contour indices, in
// stacking order (by their outer contour).
export function contourObjects(contours) {
  const book = new CurveBook();
  const paths = contours.map((c) => book.paths([c])[0] ?? []);
  const area = paths.map((p) => (p.length > 2 ? ClipperLib.Clipper.Area(p) : 0));
  const outer = paths.map((_, i) => i).filter((i) => area[i] > 0);
  const groups = new Map(outer.map((i) => [i, [i]]));
  paths.forEach((p, i) => {
    if (area[i] >= 0 || !p.length) return;
    // A hole belongs to the smallest outer contour around it.
    const inside = outer.filter((o) => ClipperLib.Clipper.PointInPolygon(p[0], paths[o]) !== 0);
    const host = inside.sort((a, b) => area[a] - area[b])[0];
    if (host !== undefined) groups.get(host).push(i);
    else groups.set(i, [i]); // a stray reversed contour: its own object
  });
  return [...groups.values()].sort((a, b) => a[0] - b[0]);
}

// Pathfinder on objects (lists of contours), like Illustrator:
//   unite – all of them together      minusFront – the top one cuts the rest
//   intersect – only what all share   exclude – overlaps removed
export function pathfinder(op, objects) {
  const book = new CurveBook();
  const regions = objects.map((contours) => unionPaths(book.paths(contours)));
  let result;
  if (op === "unite") {
    result = unionPaths(regions.flat());
  } else if (op === "minusFront") {
    const front = regions[regions.length - 1];
    result = clipperOp(ClipperLib.ClipType.ctDifference, unionPaths(regions.slice(0, -1).flat()), front);
  } else {
    const type = op === "intersect" ? ClipperLib.ClipType.ctIntersection : ClipperLib.ClipType.ctXor;
    result = regions.slice(1).reduce((acc, r) => clipperOp(type, acc, r), regions[0]);
  }
  return result.map((path) => book.refit(path));
}
