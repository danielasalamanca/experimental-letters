import { test } from "node:test";
import assert from "node:assert/strict";
import { glyphContours, bridgeGeometry } from "../js/outline.js";
import { joinBridges } from "../js/geometry.js";

// Turns contours into polygons (curves sampled finely).
function flatten(contours) {
  return contours.map((cmds) => {
    const pts = [];
    let cur = null;
    for (const c of cmds) {
      if (c.type === "M" || c.type === "L") { cur = [c.x, c.y]; pts.push(cur); }
      else if (c.type === "C") {
        const [x0, y0] = cur;
        for (let i = 1; i <= 64; i++) {
          const t = i / 64, u = 1 - t;
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

// The ink, straight from its definition: stars plus bridges.
function inside(set, curve, joinWidth, [x, y]) {
  const rho = curve / 2;
  const c = Math.floor(x), r = Math.floor(y);
  if (set.has(`${c},${r}`)) {
    const nx = Math.round(x), ny = Math.round(y);
    if (Math.hypot(x - nx, y - ny) > rho) return true;
  }
  const { width } = bridgeGeometry(curve, joinWidth);
  return joinBridges([...set], curve, width).some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
}

// Points too close to an edge of the ink are skipped (sampling tolerance).
function nearEdge(curve, [x, y], joinWidth) {
  const rho = curve / 2;
  const d = Math.hypot(x - Math.round(x), y - Math.round(y));
  const fx = x - Math.floor(x), fy = y - Math.floor(y);
  const { half, len } = bridgeGeometry(curve, joinWidth);
  const near = (v, t) => Math.abs(v - t) < 0.004;
  return Math.abs(d - rho) < 0.004 || near(fx, 0) || near(fy, 0) || near(fx, 1) || near(fy, 1) ||
    near(fx, half) || near(fx, 1 - half) || near(fy, half) || near(fy, 1 - half) ||
    near(fx, 0.5 - len) || near(fx, 0.5 + len) || near(fy, 0.5 - len) || near(fy, 0.5 + len) ||
    near(Math.abs(x - Math.round(x)), len) || near(Math.abs(y - Math.round(y)), len);
}

function check(cells, curve, joinWidth) {
  const set = new Set(cells);
  const polys = flatten(glyphContours(cells, { curve, joinWidth }));
  let checked = 0;
  for (let i = 0; i < 4000; i++) {
    // A deterministic, irregular sample over the drawing area.
    const p = [((i * 0.6180339887) % 1) * 9 - 1, ((i * 0.7548776662 + 0.1) % 1) * 9 - 1];
    if (nearEdge(curve, p, joinWidth)) continue;
    const w = winding(polys, p);
    assert.ok(w === 0 || w === 1, `superposición o dirección incorrecta en ${p} (winding ${w})`);
    assert.equal(w === 1, inside(set, curve, joinWidth, p), `forma distinta en ${p} (curva ${curve}, unión ${joinWidth})`);
    checked++;
  }
  assert.ok(checked > 3000);
}

const SHAPES = {
  single: ["2,2"],
  row: ["1,1", "2,1", "3,1", "4,1"],
  block: ["1,1", "2,1", "3,1", "1,2", "2,2", "3,2", "1,3", "2,3", "3,3"],
  ring: ["1,1", "2,1", "3,1", "1,2", "3,2", "1,3", "2,3", "3,3"],
  diagonal: ["1,1", "2,2", "3,3", "2,1"],
  pinch: ["1,1", "2,2", "1,3", "0,2"],
  sample: ["2,6", "3,6", "4,6", "1,5", "4,5", "5,5", "1,4", "4,4", "0,3", "1,3", "2,3", "3,3", "4,3", "0,2", "4,2", "0,1", "1,1", "4,1", "5,1", "1,0", "2,0", "3,0", "5,0", "6,0"],
};

for (const [name, cells] of Object.entries(SHAPES)) {
  for (const curve of [1, 0.85, 0.5]) {
    for (const join of [0, 0.3, 0.7]) {
      test(`outline matches the ink: ${name}, curve ${curve}, join ${join}`, () => check(cells, curve, join));
    }
  }
}

test("random drawings", () => {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 12; n++) {
    const cells = [];
    for (let c = 0; c < 7; c++) for (let r = 0; r < 7; r++) if (rand() < 0.55) cells.push(`${c},${r}`);
    check(cells, [1, 0.9, 0.6][n % 3], [0, 0.3, 0.6][Math.floor(n / 3) % 3]);
  }
});

test("outer contours run counter-clockwise, counters clockwise", () => {
  const area = (pts) => pts.reduce((s, [x0, y0], i) => {
    const [x1, y1] = pts[(i + 1) % pts.length];
    return s + (x0 * y1 - x1 * y0) / 2;
  }, 0);
  const [outer, ...holes] = flatten(glyphContours(SHAPES.ring, { curve: 0.5, joinWidth: 0 }));
  assert.ok(area(outer) > 0);
  assert.equal(holes.length, 1);
  assert.ok(area(holes[0]) < 0);
});
