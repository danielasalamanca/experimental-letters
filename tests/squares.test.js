import { test } from "node:test";
import assert from "node:assert/strict";
import { squareContours } from "../js/outline.js";

function flatten(contours) {
  return contours.map((cmds) => {
    const pts = [];
    let cur = null;
    for (const c of cmds) {
      if (c.type === "M" || c.type === "L") { cur = [c.x, c.y]; pts.push(cur); }
      else if (c.type === "C") {
        const [x0, y0] = cur;
        for (let i = 1; i <= 48; i++) {
          const t = i / 48, u = 1 - t;
          pts.push([
            u * u * u * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
            u * u * u * y0 + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
          ]);
        }
        cur = [c.x, c.y];
      }
    }
    return pts;
  });
}

function winding(polys, [px, py]) {
  let w = 0;
  for (const pts of polys) {
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      if (y0 <= py && y1 > py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) > 0) w++;
      else if (y0 > py && y1 <= py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) < 0) w--;
    }
  }
  return w;
}

function distToPolys(polys, [px, py]) {
  let best = Infinity;
  for (const pts of polys) {
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      const dx = x1 - x0, dy = y1 - y0;
      const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(px - x0 - t * dx, py - y0 - t * dy));
    }
  }
  return best;
}

// The rounded union, from its definition: a point near a lattice corner is
// decided by the 2×2 cells around that corner.
function insideRounded(set, rounding, [x, y]) {
  const r = rounding / 2;
  const has = (c, rr) => set.has(`${c},${rr}`);
  const filled = has(Math.floor(x), Math.floor(y));
  const px = Math.round(x), py = Math.round(y);
  const dx = x - px, dy = y - py;
  if (r === 0 || Math.abs(dx) >= r || Math.abs(dy) >= r) return filled;
  // Quadrant of the point and its neighbours around the corner.
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const cx = sx > 0 ? px : px - 1, cy = sy > 0 ? py : py - 1;
  const horiz = has(cx - sx, cy), vert = has(cx, cy - sy);
  const outsideFillet = Math.hypot(Math.abs(dx) - r, Math.abs(dy) - r) > r;
  if (filled && !horiz && !vert) return !outsideFillet || (Math.abs(dx) >= r || Math.abs(dy) >= r); // outer corner
  if (!filled && horiz && vert && has(cx - sx, cy - sy)) return outsideFillet && Math.abs(dx) < r && Math.abs(dy) < r;        // inner corner
  return filled;
}

function check(cells, rounding, stroke) {
  const set = new Set(cells);
  const polys = flatten(squareContours(cells, { rounding, stroke }));
  const fillPolys = flatten(squareContours(cells, { rounding, stroke: 0 }));
  let checked = 0;
  for (let i = 0; i < 5000; i++) {
    const p = [((i * 0.6180339887) % 1) * 8 - 1, ((i * 0.7548776662 + 0.1) % 1) * 8 - 1];
    const d = distToPolys(fillPolys, p);
    if (d < 0.004 || Math.abs(d - stroke) < 0.004) continue;
    const w = winding(polys, p);
    assert.ok(w === 0 || w === 1, `superposición en ${p} (winding ${w})`);
    let expected = insideRounded(set, rounding, p);
    if (stroke > 0) expected = expected && d < stroke;
    assert.equal(w === 1, expected, `forma distinta en ${p} (redondeo ${rounding}, contorno ${stroke})`);
    checked++;
  }
  assert.ok(checked > 4000);
}

const SHAPES = {
  single: ["2,2"],
  ell: ["1,1", "2,1", "3,1", "1,2", "1,3"],
  ring: ["1,1", "2,1", "3,1", "1,2", "3,2", "1,3", "2,3", "3,3"],
  pinch: ["1,1", "2,2"],
  stairs: ["0,0", "1,0", "1,1", "2,1", "2,2", "3,2", "0,1"],
  a: ["1,0", "2,0", "3,0", "5,0", "0,1", "3,1", "4,1", "0,2", "3,2", "1,3", "2,3", "3,3", "3,4", "0,5", "1,5", "2,5", "3,5"],
};

for (const [name, cells] of Object.entries(SHAPES)) {
  for (const rounding of [0, 0.3, 1]) {
    for (const stroke of [0, 0.2, 0.45]) {
      test(`squares: ${name}, rounding ${rounding}, stroke ${stroke}`, () => check(cells, rounding, stroke));
    }
  }
}

test("squares: random drawings", () => {
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 12; n++) {
    const cells = [];
    for (let c = 0; c < 6; c++) for (let r = 0; r < 6; r++) if (rand() < 0.55) cells.push(`${c},${r}`);
    check(cells, [0, 0.4, 0.8][n % 3], [0, 0.15, 0.3][Math.floor(n / 3) % 3]);
  }
});
