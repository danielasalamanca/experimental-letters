// Exact outlines for font export.
//
// The ink of a glyph is the union of its stars plus the "unión mínima"
// bridges. Stars are squares minus the circles centred on their corners,
// and the circles of radius ρ = curve / 2 never overlap, so:
//
//   ink = (union of filled squares) − (circle at every lattice point)
//         + bridges
//
// That lets us build the outline directly, without a boolean library:
// trace the outline of the filled squares (lattice edges with the ink on
// the left, so outer contours run counter-clockwise and counters clockwise,
// as CFF/OpenType expects) and, at every lattice point the outline passes
// through, replace the corner with an arc of that point's circle. Where the
// arc crosses an edge shared by two filled cells, the bridge cuts it with a
// straight flat. Lattice points surrounded by four filled cells leave a
// hole: the circle (or, with bridges, the circle flattened on four sides).
//
// Coordinates are in cells, y up. Contours are lists of commands:
//   { type: "M" | "L", x, y }  { type: "C", x1, y1, x2, y2, x, y }  { type: "Z" }

import { key, parseKey } from "./geometry.js";

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // E, N, W, S (k * 90°)
const QUARTER = Math.PI / 2;
const EPS = 1e-9;

// Widest bridge we draw (in cells), so a bridge never swallows a circle.
export const MAX_JOIN = 0.8;

export function bridgeGeometry(curve, joinWidth) {
  const rho = curve / 2;
  const width = Math.min(Math.max(joinWidth, 0), MAX_JOIN);
  const half = (1 - width) / 2;            // distance from a lattice point to a bridge
  const bridged = width > 0 && half < rho; // the neck is narrower than the minimum
  const len = bridged ? Math.sqrt(rho * rho - half * half) : 0;
  return { rho, width, half, bridged, len, phi: bridged ? Math.atan2(len, half) : 0 };
}

export function glyphContours(cells, { curve, joinWidth = 0 }) {
  const set = new Set(cells);
  const has = (c, r) => set.has(key(c, r));
  const geo = bridgeGeometry(curve, joinWidth);
  const contours = [];

  for (const loop of traceLoops(set, has)) contours.push(loopContour(loop, geo));

  // Lattice points inside the ink leave a hole.
  const seen = new Set();
  for (const k of set) {
    const [c, r] = parseKey(k);
    for (const [px, py] of [[c, r], [c + 1, r], [c, r + 1], [c + 1, r + 1]]) {
      const pk = key(px, py);
      if (seen.has(pk)) continue;
      seen.add(pk);
      if (has(px, py) && has(px - 1, py) && has(px - 1, py - 1) && has(px, py - 1)) {
        contours.push(holeContour([px, py], geo));
      }
    }
  }
  return contours;
}

// Outlines of the union of filled squares, as lists of lattice vertices
// with the direction the outline arrives and leaves by.
function traceLoops(set, has) {
  const edges = new Map(); // start point -> edges leaving it
  const add = (x, y, dir) => {
    const k = key(x, y);
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push({ x, y, dir, used: false });
  };
  for (const k of set) {
    const [c, r] = parseKey(k);
    if (!has(c, r - 1)) add(c, r, 0);
    if (!has(c + 1, r)) add(c + 1, r, 1);
    if (!has(c, r + 1)) add(c + 1, r + 1, 2);
    if (!has(c - 1, r)) add(c, r + 1, 3);
  }

  const loops = [];
  for (const list of edges.values()) {
    for (const first of list) {
      if (first.used) continue;
      const loop = [];
      let edge = first;
      first.used = true;
      while (true) {
        const x = edge.x + DIRS[edge.dir][0], y = edge.y + DIRS[edge.dir][1];
        const out = edges.get(key(x, y)) ?? [];
        // Prefer turning left, then straight, then right: keeps the ink on
        // the left and splits outlines that only touch at a corner.
        let next = null;
        for (const turn of [1, 0, 3]) {
          next = out.find((e) => (e === first || !e.used) && e.dir === (edge.dir + turn) % 4) ?? null;
          if (next) break;
        }
        loop.push({ x, y, din: edge.dir, dout: (next ?? first).dir });
        if (!next || next === first) break;
        next.used = true;
        edge = next;
      }
      loops.push(loop);
    }
  }
  return loops;
}

class Builder {
  constructor() { this.cmds = []; this.cur = null; }
  moveTo([x, y]) { this.cmds.push({ type: "M", x, y }); this.cur = [x, y]; this.start = [x, y]; }
  lineTo([x, y]) {
    if (Math.hypot(x - this.cur[0], y - this.cur[1]) < EPS) return;
    this.cmds.push({ type: "L", x, y });
    this.cur = [x, y];
  }
  // Clockwise arc around `center` from angle a0 down to a1.
  arc(center, rho, a0, a1) {
    const total = a0 - a1;
    if (total < EPS) return;
    const n = Math.ceil(total / QUARTER - 1e-6);
    const step = total / n;
    const k = (4 / 3) * Math.tan(step / 4) * rho;
    for (let i = 0; i < n; i++) {
      const a = a0 - i * step, b = a - step;
      const p3 = polar(center, rho, b);
      this.cmds.push({
        type: "C",
        x1: center[0] + rho * Math.cos(a) + k * Math.sin(a), y1: center[1] + rho * Math.sin(a) - k * Math.cos(a),
        x2: p3[0] - k * Math.sin(b), y2: p3[1] + k * Math.cos(b),
        x: p3[0], y: p3[1],
      });
      this.cur = p3;
    }
  }
  close() {
    if (this.start) this.lineTo(this.start);
    this.cmds.push({ type: "Z" });
    return this.cmds;
  }
}

const polar = ([x, y], rho, a) => [x + rho * Math.cos(a), y + rho * Math.sin(a)];

// Corner where the flats of two neighbouring bridges meet.
const corner = ([x, y], half, a, b) =>
  [x + half * (Math.cos(a) + Math.cos(b)), y + half * (Math.sin(a) + Math.sin(b))];

// Goes clockwise around lattice point P from angle `from`, crossing
// `steps - 1` arms shared by filled cells, ending at angle `from - steps·90°`.
function sweep(b, P, from, steps, geo) {
  const { rho, half, bridged, phi } = geo;
  let angle = from;
  let open = null; // angle of the bridge flat we are on
  for (let i = 1; i < steps && bridged; i++) {
    const theta = from - i * QUARTER;
    if (open !== null && open - phi < theta + phi) {
      b.lineTo(corner(P, half, open, theta)); // the two flats cross
    } else {
      if (open !== null) { b.lineTo(polar(P, rho, open - phi)); angle = open - phi; }
      b.arc(P, rho, angle, theta + phi);
    }
    open = theta;
  }
  if (open !== null) { b.lineTo(polar(P, rho, open - phi)); angle = open - phi; }
  b.arc(P, geo.rho, angle, from - steps * QUARTER);
}

function loopContour(loop, geo) {
  const b = new Builder();
  const armIn = (v) => (v.din + 2) % 4; // the arm we arrived along, seen from v
  const first = loop[0];
  b.moveTo(polar([first.x, first.y], geo.rho, armIn(first) * QUARTER));
  loop.forEach((v, i) => {
    const a = armIn(v);
    const steps = (a - v.dout + 4) % 4;
    sweep(b, [v.x, v.y], a * QUARTER, steps, geo);
    const next = loop[(i + 1) % loop.length];
    b.lineTo(polar([next.x, next.y], geo.rho, armIn(next) * QUARTER));
  });
  return b.close();
}

function holeContour(P, geo) {
  const b = new Builder();
  const { rho, half, bridged, phi } = geo;
  if (!bridged) {
    b.moveTo(polar(P, rho, 0));
    b.arc(P, rho, 0, -2 * Math.PI);
    return b.close();
  }
  if (2 * phi > QUARTER) {
    // Bridges on all four arms cross each other: the hole is a square.
    b.moveTo(corner(P, half, 0, -QUARTER));
    for (let i = 1; i < 4; i++) b.lineTo(corner(P, half, -i * QUARTER, -(i + 1) * QUARTER));
    return b.close();
  }
  b.moveTo(polar(P, rho, phi));
  for (let i = 0; i < 4; i++) {
    const theta = -i * QUARTER;
    b.lineTo(polar(P, rho, theta - phi));
    b.arc(P, rho, theta - phi, theta - QUARTER + phi);
  }
  return b.close();
}

// --- Square grid ---
// Each filled cell is a square, so the ink is the union of the squares:
// exactly the traced loops. Corners can be rounded: outer corners get a
// fillet that cuts into the ink, inner corners one that fills the empty
// corner. `rounding` (0–1) gives every corner a radius of up to half a cell;
// `corners` sets the radius (in cells, or "max") of single corners, keyed by
// their lattice point "x,y". Radii bigger than a cell make arches: an outer
// corner of 2 around an inner corner of 1 is a concentric arch of width 1.
//
// Each radius is limited so the shape stays valid: a fillet never reaches an
// empty cell (outer corner) or a filled one (inner corner), and two corners
// never take more than the edge between them.
//
// With `stroke` (in cells, below 0.5) the glyph is an outline instead: the
// ink minus a copy inset by `stroke`. Insetting a rounded corner of radius r
// gives r − stroke on outer corners and r + stroke on inner ones, so the
// inset loop is built the same way and added in the opposite direction.
export const MAX_STROKE = 0.45;
export const MAX_RADIUS = 12;

export function squareContours(cells, { rounding = 0, stroke = 0, corners = {} }) {
  const set = new Set(cells);
  const has = (c, r) => set.has(key(c, r));
  const base = Math.min(Math.max(rounding, 0), 1) / 2;
  const t = Math.min(Math.max(stroke, 0), MAX_STROKE);
  const contours = [];
  for (const loop of traceLoops(set, has)) {
    const turns = cornerList(loop);
    // As an outline, walls must stay at least two strokes wide.
    const radii = cornerRadii(turns, has, 2 * t, (v) => {
      const want = corners[key(v.x, v.y)];
      return want === undefined ? base : want === "max" ? MAX_RADIUS : Math.min(Math.max(+want || 0, 0), MAX_RADIUS);
    });
    contours.push(roundedLoop(turns.map((v, i) => ({ ...v, r: radii[i] }))));
    if (t > 0) {
      const inset = turns.map((v, i) => {
        const [ax, ay] = DIRS[(v.din + 1) % 4], [bx, by] = DIRS[(v.dout + 1) % 4];
        return {
          x: v.x + t * (ax + bx), y: v.y + t * (ay + by),
          // Reversed: the inset is a hole in the ink.
          din: (v.dout + 2) % 4, dout: (v.din + 2) % 4,
          r: v.turn === 1 ? Math.max(radii[i] - t, 0) : radii[i] + t,
        };
      }).reverse();
      // A corner sharper than the stroke stays sharp inside, so its edge
      // can run short: share the edges again.
      shareEdges(inset, inset.map((v) => v.r)).forEach((r, i) => { inset[i].r = r; });
      contours.push(roundedLoop(inset));
    }
  }
  return contours;
}

// Corners of the outline (where it turns): { x, y, turn } with turn 1 for
// outer corners and 3 for inner ones. Used to show the corners to click.
export function squareCorners(cells) {
  const set = new Set(cells);
  const has = (c, r) => set.has(key(c, r));
  return traceLoops(set, has).flatMap(cornerList);
}

const cornerList = (loop) =>
  loop.map((v) => ({ ...v, turn: (v.dout - v.din + 4) % 4 })).filter((v) => v.turn !== 0);

function cornerRadii(turns, has, wall, wanted) {
  const radii = turns.map((v) => {
    const want = wanted(v);
    return want > 0 ? Math.min(want, roomAt(v, has, want, v.turn === 1 ? wall : 0)) : 0;
  });
  return shareEdges(turns, radii);
}

// Two corners on the same edge share its length.
function shareEdges(turns, radii) {
  const n = turns.length;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const L = Math.abs(turns[j].x - turns[i].x) + Math.abs(turns[j].y - turns[i].y);
      if (radii[i] + radii[j] <= L + EPS) continue;
      if (radii[i] >= L / 2 && radii[j] >= L / 2) radii[i] = radii[j] = L / 2;
      else if (radii[i] > radii[j]) radii[i] = L - radii[j];
      else radii[j] = L - radii[i];
    }
  }
  return radii;
}

// Largest radius (up to `want`) whose fillet stays on the right cells.
// In corner coordinates (a along the incoming edge, b along the outgoing
// one), the fillet of radius r covers the part of the r×r square outside
// the circle centred at (r, r). Cell (i, j) of that square is touched once
// r > i + j + √(2ij); it must be filled for an outer corner and empty for
// an inner one. With `wall` > 0 an outer fillet also keeps that much ink
// between itself and an empty cell: (r − i)² + (r − j)² ≤ (r − wall)²,
// which holds up to r = (i + j − wall) + √(2(i − wall)(j − wall)).
export function roomAt(v, has, want, wall = 0) {
  const [e1x, e1y] = DIRS[(v.din + 2) % 4], [e2x, e2y] = DIRS[v.dout];
  const outer = v.turn === 1;
  let room = want;
  const n = Math.ceil(want);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const diagonal = i > 0 && j > 0;
      const reach = diagonal ? i + j - wall + Math.sqrt(2 * (i - wall) * (j - wall)) : i + j;
      if (reach >= room) continue;
      const c = Math.floor(v.x + (i + 0.5) * e1x + (j + 0.5) * e2x);
      const r = Math.floor(v.y + (i + 0.5) * e1y + (j + 0.5) * e2y);
      if (has(c, r) !== outer) room = reach;
    }
  }
  return room;
}

// A loop of corners joined by straight edges; each corner is cut by a
// quarter circle of radius r tangent to both edges.
function roundedLoop(corners) {
  const b = new Builder();
  const K = 0.5522847498; // cubic approximation of a quarter circle
  const ends = corners.map((v) => {
    const [ix, iy] = DIRS[v.din], [ox, oy] = DIRS[v.dout];
    return { v, s: [v.x - v.r * ix, v.y - v.r * iy], e: [v.x + v.r * ox, v.y + v.r * oy], ix, iy, ox, oy };
  });
  b.moveTo(ends[0].e);
  for (let i = 1; i <= ends.length; i++) {
    const { v, s, e, ix, iy, ox, oy } = ends[i % ends.length];
    b.lineTo(s);
    if (v.r > EPS) {
      const k = K * v.r;
      b.cmds.push({ type: "C", x1: s[0] + k * ix, y1: s[1] + k * iy, x2: e[0] - k * ox, y2: e[1] - k * oy, x: e[0], y: e[1] });
      b.cur = e;
    }
  }
  return b.close();
}
