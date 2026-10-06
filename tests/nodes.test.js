import { test } from "node:test";
import assert from "node:assert/strict";
import * as opentype from "../js/vendor/opentype.min.js";
import {
  commandsToOutline, outlineToCommands, splitSegment, toggleSmooth, deleteNodes, nearestSegment, snapToGrid, isSmooth,
} from "../js/nodes.js";
import { ownContours, glyphFinalContours } from "../js/shapes.js";
import { normalizeFont, createGlyph } from "../js/model.js";
import { buildOtf } from "../js/otf.js";

function flatten(contours) {
  return contours.map((cmds) => {
    const pts = [];
    let cur = null;
    for (const c of cmds) {
      if (c.type === "M" || c.type === "L") { cur = [c.x, c.y]; pts.push(cur); }
      else if (c.type === "C") {
        const [x0, y0] = cur;
        for (let i = 1; i <= 32; i++) {
          const t = i / 32, u = 1 - t;
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
const area = (contours) => flatten(contours).reduce((sum, pts) => sum + pts.reduce((s, [x0, y0], i) => {
  const [x1, y1] = pts[(i + 1) % pts.length];
  return s + (x0 * y1 - x1 * y0) / 2;
}, 0), 0);

const square = [{ type: "M", x: 0, y: 0 }, { type: "L", x: 2, y: 0 }, { type: "L", x: 2, y: 2 }, { type: "L", x: 0, y: 2 }, { type: "Z" }];

test("contours turn into nodes and back without changing", () => {
  const outline = commandsToOutline([square]);
  assert.equal(outline[0].nodes.length, 4);
  assert.ok(Math.abs(area(outlineToCommands(outline)) - 4) < 1e-9);
  // A letter from the grid (the sample "a", stars): same area as nodes.
  const font = normalizeFont(null);
  const a = ownContours(font, font.glyphs.a);
  const again = outlineToCommands(commandsToOutline(a));
  assert.ok(Math.abs(area(again) - area(a)) < 1e-9);
});

test("adding a node keeps the curve; corner and smooth toggle", () => {
  const curve = [{ type: "M", x: 0, y: 0 }, { type: "C", x1: 0, y1: 1, x2: 1, y2: 2, x: 2, y: 2 }, { type: "L", x: 2, y: 0 }, { type: "Z" }];
  const outline = commandsToOutline([curve]);
  const before = area(outlineToCommands(outline));
  const hit = nearestSegment(outline, [0.4, 1.3]);
  assert.equal(hit.index, 0);
  splitSegment(outline, hit.contour, hit.index, hit.t);
  assert.equal(outline[0].nodes.length, 4);
  assert.ok(Math.abs(area(outlineToCommands(outline)) - before) < 5e-3);
  assert.ok(isSmooth(outline[0].nodes[1]));
  toggleSmooth(outline, 0, 1);
  assert.equal(outline[0].nodes[1].in, null);
  toggleSmooth(outline, 0, 1);
  assert.ok(isSmooth(outline[0].nodes[1]));
});

test("deleting nodes and snapping", () => {
  const outline = commandsToOutline([square]);
  assert.equal(deleteNodes(outline, ["0:1"])[0].nodes.length, 3);
  assert.equal(deleteNodes(outline, ["0:1", "0:2"]).length, 0);
  assert.deepEqual(snapToGrid([2.1, 3.05]), [2, 3]);
  assert.deepEqual(snapToGrid([2.48, 3.52]), [2.5, 3.5]);
  assert.deepEqual(snapToGrid([2.3, 3.3]), [2.3, 3.3]);
});

test("a glyph edited with nodes is drawn, composed and exported", async () => {
  const font = normalizeFont(null);
  // The "a" becomes a moved square; "á" (a + accent) follows it.
  const outline = commandsToOutline([square]);
  outline[0].nodes[2].x = 3; // drag a node
  font.glyphs.a = createGlyph({ ...font.glyphs.a, outline });
  font.glyphs.a.cells = ["0,0"]; // hidden while the outline is used
  const own = glyphFinalContours(font, font.glyphs.a);
  assert.ok(Math.abs(area(own) - 5) < 1e-6);
  const composite = glyphFinalContours(font, font.glyphs["á"]);
  assert.ok(Math.abs(area(composite) - 5) < 1e-6, "la á usa el contorno de la a");
  // Overlapping hand-drawn contours are merged in the font.
  font.glyphs.b = createGlyph({ outline: commandsToOutline([square, square.map((c) => (c.type === "Z" ? c : { ...c, x: c.x + 1 }))]) });
  const otf = opentype.parse(await buildOtf(font));
  const moves = otf.charToGlyph("b").path.commands.filter((c) => c.type === "M").length;
  assert.equal(moves, 1);
  assert.equal(otf.charToGlyph("a").path.commands.filter((c) => c.type === "M").length, 1);
});

// --- Pathfinder and live corners on node outlines ---
import { pathfinder, contourObjects, roundedContours, contourCorners } from "../js/pieces.js";

const rect = (x0, y0, x1, y1) => [{ type: "M", x: x0, y: y0 }, { type: "L", x: x1, y: y0 }, { type: "L", x: x1, y: y1 }, { type: "L", x: x0, y: y1 }, { type: "Z" }];
const reversed = (cmds) => {
  const pts = cmds.filter((c) => c.type !== "Z").map((c) => [c.x, c.y]).reverse();
  return [{ type: "M", x: pts[0][0], y: pts[0][1] }, ...pts.slice(1).map(([x, y]) => ({ type: "L", x, y })), { type: "Z" }];
};

test("pathfinder: unite, minus front, intersect and exclude", () => {
  const a = [rect(0, 0, 4, 4)], b = [rect(2, 2, 6, 6)];
  assert.ok(Math.abs(area(pathfinder("unite", [a, b])) - 28) < 1e-6);
  assert.ok(Math.abs(area(pathfinder("minusFront", [a, b])) - 12) < 1e-6);
  assert.ok(Math.abs(area(pathfinder("intersect", [a, b])) - 4) < 1e-6);
  assert.ok(Math.abs(area(pathfinder("exclude", [a, b])) - 24) < 1e-6);
  // Curves survive: a circle cut out of a square keeps its arcs.
  const circle = commandsToOutline([rect(0, 0, 1, 1)]);
  const K = 0.5522847498;
  circle[0].nodes = [
    { x: 3, y: 2, in: [0, -K], out: [0, K] }, { x: 2, y: 3, in: [K, 0], out: [-K, 0] },
    { x: 1, y: 2, in: [0, K], out: [0, -K] }, { x: 2, y: 1, in: [-K, 0], out: [K, 0] },
  ];
  const cut = pathfinder("minusFront", [[rect(0, 0, 4, 4)], outlineToCommands(circle)]);
  assert.ok(cut.flat().filter((c) => c.type === "C").length >= 4);
  assert.ok(Math.abs(area(cut) - (16 - Math.PI)) < 0.01);
});

test("shapes are outer contours with their holes", () => {
  const ring = [rect(0, 0, 6, 6), reversed(rect(2, 2, 4, 4)), rect(10, 0, 12, 2)];
  assert.deepEqual(contourObjects(ring), [[0, 1], [2]]);
});

test("live corners round a node outline and keep its nodes", () => {
  const square = [rect(0, 0, 4, 4)];
  const corners = contourCorners(square, {});
  assert.deepEqual(corners.map((c) => c.key).sort(), ["0,0", "0,4", "4,0", "4,4"]);
  const rounded = roundedContours(square, { corners: { "4,4": 2 } });
  assert.ok(Math.abs(area(rounded) - (16 - (4 - Math.PI))) < 0.01);
  assert.equal(rounded[0].filter((c) => c.type === "C").length, 1);
});

test("a glyph edited with nodes gets its rounded corners in the font", async () => {
  const font = normalizeFont(null);
  font.glyphs.o = createGlyph({ cols: 4, outline: commandsToOutline([rect(0, 0, 4, 4)]), corners: { "0,4": 2, "4,4": 2 } });
  const otf = opentype.parse(await buildOtf(font));
  assert.equal(otf.charToGlyph("o").path.commands.filter((c) => c.type === "C").length, 2);
});
