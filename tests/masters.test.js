import { test } from "node:test";
import assert from "node:assert/strict";
import {
  thickenOutline, normalizeContours, compatible, incompatibility, interpolateContours, instances,
  normalizeAxis, weightT, masterPair, atWeight, makeBold, refreshBold, mastersReport,
} from "../js/masters.js";
import { commandsToOutline, outlineToCommands } from "../js/nodes.js";
import { normalizeFont, advanceWidth, createGlyph } from "../js/model.js";

const square = (x0, y0, x1, y1, ccw = true) => {
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  if (!ccw) pts.reverse();
  return [{ type: "M", x: pts[0][0], y: pts[0][1] }, ...pts.slice(1).map(([x, y]) => ({ type: "L", x, y })), { type: "Z" }];
};
const xs = (outline) => outline.flatMap((c) => c.nodes.map((n) => n.x));
const ys = (outline) => outline.flatMap((c) => c.nodes.map((n) => n.y));
const close = (a, b) => Math.abs(a - b) < 1e-9;

test("thickening a square moves every side out", () => {
  const out = thickenOutline(commandsToOutline([square(0, 0, 2, 3)]), 0.5);
  assert.deepEqual([Math.min(...xs(out)), Math.max(...xs(out)), Math.min(...ys(out)), Math.max(...ys(out))], [-0.5, 2.5, -0.5, 3.5]);
});

test("thickening a ring makes its hole smaller, whatever the direction", () => {
  for (const ccw of [true, false]) {
    const ring = commandsToOutline([square(0, 0, 6, 6, ccw), square(2, 2, 4, 4, !ccw)]);
    const out = thickenOutline(ring, 0.5);
    const outer = out[0].nodes, hole = out[1].nodes;
    assert.ok(close(Math.min(...outer.map((n) => n.x)), -0.5));
    assert.ok(close(Math.min(...hole.map((n) => n.x)), 2.5));
    assert.ok(close(Math.max(...hole.map((n) => n.x)), 3.5));
  }
});

test("a thickened circle stays round", () => {
  const K = 0.5522847498;
  const r = 2;
  const circle = [[
    { type: "M", x: r, y: 0 },
    { type: "C", x1: r, y1: K * r, x2: K * r, y2: r, x: 0, y: r },
    { type: "C", x1: -K * r, y1: r, x2: -r, y2: K * r, x: -r, y: 0 },
    { type: "C", x1: -r, y1: -K * r, x2: -K * r, y2: -r, x: 0, y: -r },
    { type: "C", x1: K * r, y1: -r, x2: r, y2: -K * r, x: r, y: 0 },
    { type: "Z" },
  ]];
  const out = outlineToCommands(thickenOutline(commandsToOutline(circle), 1));
  const first = out[0][1];
  assert.ok(close(first.x, 0) && close(first.y, 3));
  assert.ok(Math.abs(first.x1 - 3) < 1e-9 && Math.abs(first.y1 - K * 3) < 1e-9);
  assert.ok(compatible(normalizeContours(circle), out));
});

test("compatibility and interpolation", () => {
  const a = normalizeContours([square(0, 0, 2, 2)]);
  const b = normalizeContours([square(-1, -1, 3, 3)]);
  assert.ok(compatible(a, b));
  const mid = interpolateContours(a, b, 0.5);
  assert.deepEqual(mid[0].filter((c) => c.type !== "Z").map((c) => [c.x, c.y]), [[-0.5, -0.5], [2.5, -0.5], [2.5, 2.5], [-0.5, 2.5]]);
  const tri = normalizeContours([[{ type: "M", x: 0, y: 0 }, { type: "L", x: 1, y: 0 }, { type: "L", x: 0, y: 1 }, { type: "Z" }]]);
  assert.ok(!compatible(a, tri));
  assert.match(incompatibility(a, tri), /4 punto\(s\) en Regular y 3/);
  assert.match(incompatibility(a, [...b, ...b]), /1 contorno\(s\)/);
});

test("weights between the masters", () => {
  assert.deepEqual(instances({ min: 400, max: 800 }).map((i) => i.name), ["Regular", "Medium", "SemiBold", "Bold", "ExtraBold"]);
  assert.deepEqual(instances({ min: 400, max: 750 }).map((i) => i.weight), [400, 500, 600, 700, 750]);
  assert.equal(weightT({ min: 400, max: 800 }, 600), 0.5);
  assert.deepEqual(normalizeAxis({ min: 800, max: 400 }), { min: 800, max: 900, thicken: 20 });
});

function font() {
  const f = normalizeFont(null);
  f.grid = "squares";
  f.glyphs.l.cells = ["0,0", "0,1", "0,2", "0,3"];
  f.glyphs.l.cols = 1;
  return f;
}

test("a letter gets an automatic bold master: wider ink, same sidebearings", () => {
  const f = font();
  const pair = masterPair(f, "l");
  assert.equal(pair.status, "ok");
  const bx = pair.bold.flatMap((c) => c.filter((q) => q.type !== "Z").map((q) => q.x));
  // 20 u = 0.4 cells per side; drawn from x = 0, so the sidebearing is kept.
  assert.ok(close(Math.min(...bx), 0) && close(Math.max(...bx), 1.8));
  assert.equal(pair.advance[1] - pair.advance[0], 40);
  const mid = atWeight(f, "l", 600);
  assert.equal(mid.advance, pair.advance[0] + 20);
});

test("an automatic bold master follows the Regular; an edited one doesn't", () => {
  const f = font();
  refreshBold(f, "l");
  f.glyphs.l.cells.push("0,4");
  assert.ok(Math.max(...ys(refreshBold(f, "l").outline)) > 5);
  f.glyphs.l.bold.auto = false;
  f.glyphs.l.cells.push("0,5");
  const pair = masterPair(f, "l");
  assert.equal(pair.status, "ok"); // same structure: a taller bar
  f.glyphs.l.cells.push("0,8"); // a separate dot: one more contour
  assert.equal(masterPair(f, "l").status, "incompatible");
  assert.ok(mastersReport(f, ["l"]).incompatible.includes("l"));
});

test("accented letters use the masters of their parts", () => {
  const f = font();
  f.glyphs.i.cells = ["0,0", "0,1", "0,2"];
  f.glyphs.i.cols = 1;
  f.glyphs["´"] = createGlyph({ cols: 1, cells: ["0,0"] });
  f.glyphs["í"] = createGlyph({ cols: 1, components: [{ glyph: "i", dx: 0, dy: 0 }, { glyph: "´", dx: 0, dy: 4 }] });
  const pair = masterPair(f, "í");
  assert.equal(pair.status, "ok");
  assert.equal(pair.regular.length, 2);
  assert.ok(compatible(pair.regular, pair.bold));
  assert.equal(pair.advance[1], advanceWidth(f, f.glyphs["í"]) + 40);
});

test("bold masters survive saving", () => {
  const f = font();
  refreshBold(f, "l");
  f.glyphs.l.bold.auto = false;
  const again = normalizeFont(JSON.parse(JSON.stringify(f)));
  assert.equal(again.glyphs.l.bold.auto, false);
  assert.deepEqual(again.glyphs.l.bold.outline, f.glyphs.l.bold.outline);
  assert.deepEqual(again.axis, { min: 400, max: 800, thicken: 20 });
  assert.equal(makeBold(f, f.glyphs.l).auto, true);
});

import { copyRegular, matchOutline } from "../js/masters.js";

// An "n" on the dot grid: two stems joined by a bar at the top.
function nCells(cols, stem, height = 9, bar = 2) {
  const cells = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < cols; c++) {
      const inStem = c < stem || c >= cols - stem;
      if (inStem || r >= height - bar) cells.push(`${c},${r}`);
    }
  }
  return cells;
}

test("a bold master drawn on the grid, wider, interpolates with the Regular", () => {
  const f = font();
  f.glyphs.n.cells = nCells(9, 1);
  f.glyphs.n.cols = 9;
  const bold = copyRegular(f, f.glyphs.n);
  bold.cells = nCells(13, 3, 9, 3);
  bold.cols = 13;
  f.glyphs.n.bold = bold;
  const again = normalizeFont(JSON.parse(JSON.stringify(f)));
  assert.equal(again.glyphs.n.bold.cols, 13);
  const pair = masterPair(again, "n");
  assert.equal(pair.status, "ok");
  assert.equal(pair.advance[1] - pair.advance[0], 4 * 50);
  const mid = atWeight(again, "n", 600);
  const xs = mid.contours.flat().filter((c) => c.type !== "Z").map((c) => c.x);
  assert.equal(Math.max(...xs), 11); // halfway between 9 and 13 columns
});

test("contours are matched whatever their order, start point and direction", () => {
  const sq = (x0, y0, x1, y1) => commandsToOutline([square(x0, y0, x1, y1)])[0];
  const regular = [sq(0, 0, 1, 1), sq(3, 0, 4, 1)];
  const turned = (c, r) => ({ ...c, nodes: [...c.nodes.slice(r), ...c.nodes.slice(0, r)] });
  const back = (c) => ({ ...c, nodes: [...c.nodes].reverse() });
  const bold = [back(turned(sq(5, 0, 7, 2), 2)), turned(sq(0, 0, 2, 2), 1)];
  const { outline, reason } = matchOutline(regular, bold);
  assert.equal(reason, undefined);
  assert.deepEqual(outline[0].nodes.map((n) => [n.x, n.y]), [[0, 0], [2, 0], [2, 2], [0, 2]]);
  assert.deepEqual(outline[1].nodes.map((n) => [n.x, n.y]), [[5, 0], [7, 0], [7, 2], [5, 2]]);
  const tri = commandsToOutline([[{ type: "M", x: 0, y: 0 }, { type: "L", x: 1, y: 0 }, { type: "L", x: 0, y: 1 }, { type: "Z" }]])[0];
  assert.match(matchOutline(regular, [tri, bold[1]]).reason, /4 punto/);
});
