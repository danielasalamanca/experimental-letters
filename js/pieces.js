// "Piezas": geometric pieces placed over the square grid, which add ink or
// cut it away. Each piece fills a rectangle between two lattice points and
// is one of:
//   tri      – right triangle with its right angle at `corner` (diagonals)
//   quarter  – quarter ellipse centred at `corner` (bowls, round arms)
//   spandrel – the bit between `corner` and a quarter ellipse centred at the
//              opposite corner (cutting it rounds a corner with any radii)
// `corner` is "bl", "br", "tl" or "tr" (y up); `mode` is "add" or "cut".
// Pieces apply in order on top of the drawn cells.
//
// Booleans with curves are done with Clipper on finely flattened outlines
// (robust with the many coinciding edges of a grid), then every run of
// points that came from one source curve is turned back into that exact
// curve, so the result keeps real Bézier curves.

import ClipperLib from "./vendor/clipper.js";
import { squareContours } from "./outline.js";

export const PIECE_SHAPES = { tri: "Triángulo", quarter: "Cuarto de elipse", spandrel: "Esquina curva" };

const SCALE = 1e5;          // Clipper works in integers: 1 cell = 100 000
const STEP = 0.05;          // flattening step along curves, in cells
const K = 0.5522847498;     // cubic approximation of a quarter circle/ellipse

const corners = ({ x0, y0, x1, y1 }) => ({ bl: [x0, y0], br: [x1, y0], tl: [x0, y1], tr: [x1, y1] });
const OPPOSITE = { bl: "tr", br: "tl", tl: "br", tr: "bl" };

export function normalizePiece(p) {
  return {
    x0: Math.min(p.x0, p.x1), y0: Math.min(p.y0, p.y1),
    x1: Math.max(p.x0, p.x1), y1: Math.max(p.y0, p.y1),
    corner: OPPOSITE[p.corner] ? p.corner : "bl",
    shape: PIECE_SHAPES[p.shape] ? p.shape : "tri",
    mode: p.mode === "cut" ? "cut" : "add",
  };
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
  // Quarter ellipse from P0 to P3 around `center`.
  const arc = (center, P0, P3) => ({
    type: "C",
    x1: P0[0] + K * (P3[0] - center[0]), y1: P0[1] + K * (P3[1] - center[1]),
    x2: P3[0] + K * (P0[0] - center[0]), y2: P3[1] + K * (P0[1] - center[1]),
    x: P3[0], y: P3[1],
  });
  if (p.shape === "tri") return [M(C), L(A), L(B), { type: "Z" }];
  if (p.shape === "quarter") return [M(C), L(A), arc(C, A, B), { type: "Z" }];
  return [M(C), L(A), arc(O, A, B), { type: "Z" }]; // spandrel
}

// Square-grid glyph: drawn cells (with their rounded corners) plus pieces,
// as a filled shape or, with `stroke`, as an outline.
export function squareGlyphContours(cells, { rounding = 0, corners: cornerRadii = {}, stroke = 0, pieces = [] }) {
  if (!pieces.length) return squareContours(cells, { rounding, corners: cornerRadii, stroke });
  const book = new CurveBook();
  let shape = book.paths(squareContours(cells, { rounding, corners: cornerRadii }));
  for (const piece of pieces) {
    const clip = orient(book.paths([pieceContour(piece)]));
    shape = clipperOp(piece.mode === "cut" ? ClipperLib.ClipType.ctDifference : ClipperLib.ClipType.ctUnion, shape, clip);
  }
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

function clipperOp(type, subject, clip) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const out = new ClipperLib.Paths();
  c.Execute(type, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
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
  }
  if (v !== null) {
    q = { ...q, y0: v - q.y1, y1: v - q.y0, corner: (q.corner[0] === "b" ? "t" : "b") + q.corner[1] };
  }
  return q;
}
