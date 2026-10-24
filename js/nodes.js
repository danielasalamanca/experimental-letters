// Editable outlines ("Nodos"), like Illustrator's direct selection.
//
// A glyph can be turned into a vector outline and edited node by node.
// The outline is stored in cells (y up, x from the drawing's first column):
//   [{ closed: true, nodes: [{ x, y, in: [dx, dy] | null, out: [dx, dy] | null }] }]
// `in` and `out` are the Bézier handles, relative to their node.

const EPS = 1e-9;

// Contours (M/L/C/Z commands) to an editable outline.
export function commandsToOutline(contours) {
  const outline = [];
  for (const cmds of contours) {
    const nodes = [];
    for (const c of cmds) {
      if (c.type === "M" || c.type === "L") {
        const last = nodes[nodes.length - 1];
        if (c.type === "L" && last && Math.hypot(c.x - last.x, c.y - last.y) < EPS) continue;
        nodes.push({ x: c.x, y: c.y, in: null, out: null });
      } else if (c.type === "C") {
        const prev = nodes[nodes.length - 1];
        prev.out = handle(c.x1 - prev.x, c.y1 - prev.y);
        nodes.push({ x: c.x, y: c.y, in: handle(c.x2 - c.x, c.y2 - c.y), out: null });
      }
    }
    // The contour ends where it started: one node, not two.
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (nodes.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) {
      first.in = last.in;
      nodes.pop();
    }
    if (nodes.length >= 2) outline.push({ closed: true, nodes });
  }
  return outline;
}

const handle = (dx, dy) => (Math.hypot(dx, dy) < 1e-7 ? null : [dx, dy]);

// An editable outline back to commands.
export function outlineToCommands(outline, dx = 0, dy = 0) {
  return outline.filter((c) => c.nodes.length >= 2).map(({ nodes, closed }) => {
    const n = nodes.length;
    const cmds = [{ type: "M", x: nodes[0].x + dx, y: nodes[0].y + dy }];
    const segments = closed ? n : n - 1;
    for (let i = 1; i <= segments; i++) {
      const a = nodes[i - 1], b = nodes[i % n];
      if (a.out || b.in) {
        const [ox, oy] = a.out ?? [0, 0], [ix, iy] = b.in ?? [0, 0];
        cmds.push({ type: "C", x1: a.x + ox + dx, y1: a.y + oy + dy, x2: b.x + ix + dx, y2: b.y + iy + dy, x: b.x + dx, y: b.y + dy });
      } else if (!(closed && i === n)) {
        cmds.push({ type: "L", x: b.x + dx, y: b.y + dy });
      }
    }
    cmds.push({ type: "Z" });
    return cmds;
  });
}

export const cloneOutline = (outline) =>
  outline.map((c) => ({ closed: c.closed, nodes: c.nodes.map((n) => ({ x: n.x, y: n.y, in: n.in && [...n.in], out: n.out && [...n.out] })) }));

// Shifted copy (for components).
export const shiftOutline = (outline, dx, dy) =>
  cloneOutline(outline).map((c) => ({ ...c, nodes: c.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })) }));

// Point and handles of segment i (from node i to node i + 1).
function segment(contour, i) {
  const n = contour.nodes.length;
  const a = contour.nodes[i], b = contour.nodes[(i + 1) % n];
  const p0 = [a.x, a.y], p3 = [b.x, b.y];
  const p1 = a.out ? [a.x + a.out[0], a.y + a.out[1]] : p0;
  const p2 = b.in ? [b.x + b.in[0], b.y + b.in[1]] : p3;
  return [p0, p1, p2, p3];
}

const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

function bezierAt([p0, p1, p2, p3], t) {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
}

// Nearest segment to a point: { contour, index, t, dist }.
export function nearestSegment(outline, [x, y]) {
  let best = null;
  outline.forEach((contour, ci) => {
    const n = contour.nodes.length;
    const count = contour.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const seg = segment(contour, i);
      let bt = 0, bd = Infinity;
      for (let k = 0; k <= 48; k++) {
        const t = k / 48;
        const [px, py] = bezierAt(seg, t);
        const d = Math.hypot(px - x, py - y);
        if (d < bd) { bd = d; bt = t; }
      }
      // Refine around the best sample.
      for (let step = 1 / 96; step > 1e-5; step /= 2) {
        for (const t of [bt - step, bt + step]) {
          if (t < 0 || t > 1) continue;
          const [px, py] = bezierAt(seg, t);
          const d = Math.hypot(px - x, py - y);
          if (d < bd) { bd = d; bt = t; }
        }
      }
      if (!best || bd < best.dist) best = { contour: ci, index: i, t: bt, dist: bd };
    }
  });
  return best;
}

// Adds a node on segment `index` at parameter t, keeping the curve's shape.
export function splitSegment(outline, ci, index, t) {
  const contour = outline[ci];
  const n = contour.nodes.length;
  const a = contour.nodes[index], b = contour.nodes[(index + 1) % n];
  const [p0, p1, p2, p3] = segment(contour, index);
  const curved = !!(a.out || b.in);
  let node;
  if (curved) {
    const q0 = lerp(p0, p1, t), q1 = lerp(p1, p2, t), q2 = lerp(p2, p3, t);
    const r0 = lerp(q0, q1, t), r1 = lerp(q1, q2, t), s = lerp(r0, r1, t);
    a.out = handle(q0[0] - p0[0], q0[1] - p0[1]);
    b.in = handle(q2[0] - p3[0], q2[1] - p3[1]);
    node = { x: s[0], y: s[1], in: handle(r0[0] - s[0], r0[1] - s[1]), out: handle(r1[0] - s[0], r1[1] - s[1]) };
  } else {
    const s = lerp(p0, p3, t);
    node = { x: s[0], y: s[1], in: null, out: null };
  }
  contour.nodes.splice(index + 1, 0, node);
  return index + 1;
}

// Corner ↔ smooth: a node with handles loses them; a node without gets
// smooth handles along the direction from its previous to its next node.
export function toggleSmooth(outline, ci, ni) {
  const contour = outline[ci];
  const n = contour.nodes.length;
  const node = contour.nodes[ni];
  if (node.in || node.out) {
    node.in = node.out = null;
    return;
  }
  const prev = contour.nodes[(ni - 1 + n) % n], next = contour.nodes[(ni + 1) % n];
  let dx = next.x - prev.x, dy = next.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const li = Math.hypot(node.x - prev.x, node.y - prev.y) / 3, lo = Math.hypot(next.x - node.x, next.y - node.y) / 3;
  node.in = [-dx * li, -dy * li];
  node.out = [dx * lo, dy * lo];
}

// "Enderezar": a curved segment between two chosen nodes of a contour
// becomes the sharp corner it rounds — where the line arriving at its first
// node meets the line leaving its last one. The two nodes become that one
// corner node, so a rounded corner can be undone even after it turned into
// points (and then rounded again, live, with Esquinas). `picked` holds node
// indices; returns how many corners were made.
export function straightenCurves(contour, picked) {
  const nodes = contour.nodes;
  const n = nodes.length;
  const corners = new Map(); // first node index -> the corner replacing it and the next
  const used = new Set();
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = nodes[i], b = nodes[j];
    if (!picked.has(i) || !picked.has(j) || used.has(i) || used.has(j) || !(a.out || b.in)) continue;
    const prev = nodes[(i - 1 + n) % n], next = nodes[(j + 1) % n];
    // Directions of the line arriving at a and of the one leaving b.
    const d1 = a.in ? [-a.in[0], -a.in[1]] : [a.x - prev.x, a.y - prev.y];
    const d2 = b.out ? b.out : [next.x - b.x, next.y - b.y];
    const cross = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(cross) < 1e-9) continue; // parallel: no corner to go back to
    const t = ((b.x - a.x) * d2[1] - (b.y - a.y) * d2[0]) / cross;
    corners.set(i, { x: a.x + d1[0] * t, y: a.y + d1[1] * t, in: null, out: null });
    used.add(i);
    used.add(j);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    if (corners.has(i)) out.push(corners.get(i));
    else if (!used.has(i)) out.push(nodes[i]);
  }
  if (!corners.size || out.length < 3) return 0;
  contour.nodes = out;
  return corners.size;
}

// Whether a node's handles are in line (a smooth node): moving one turns
// the other with it.
export function isSmooth(node) {
  if (!node.in || !node.out) return false;
  const [ax, ay] = node.in, [bx, by] = node.out;
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  return Math.abs(ax * by - ay * bx) / (la * lb) < 0.02 && ax * bx + ay * by < 0;
}

// Removes nodes ("ci:ni" keys); contours left with fewer than 3 nodes go.
export function deleteNodes(outline, keys) {
  const doomed = new Set(keys);
  return outline
    .map((c, ci) => ({ ...c, nodes: c.nodes.filter((_, ni) => !doomed.has(`${ci}:${ni}`)) }))
    .filter((c) => c.nodes.length >= 3);
}

// Snaps a point to the grid: whole points when close, then half points.
export function snapToGrid([x, y], strength = 0.18) {
  const near = (step, tol) => {
    const sx = Math.round(x / step) * step, sy = Math.round(y / step) * step;
    return Math.hypot(sx - x, sy - y) < tol ? [sx, sy] : null;
  };
  return near(1, strength) ?? near(0.5, strength * 0.6) ?? [x, y];
}
