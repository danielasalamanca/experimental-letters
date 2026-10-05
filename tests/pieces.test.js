import { test } from "node:test";
import assert from "node:assert/strict";
import { squareGlyphContours, pieceContour, normalizePiece, mirrorPiece } from "../js/pieces.js";

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

const area = (polys) => polys.reduce((sum, pts) => sum + pts.reduce((s, [x0, y0], i) => {
  const [x1, y1] = pts[(i + 1) % pts.length];
  return s + (x0 * y1 - x1 * y0) / 2;
}, 0), 0);

const block = (x0, y0, x1, y1) => {
  const out = [];
  for (let c = x0; c < x1; c++) for (let r = y0; r < y1; r++) out.push(`${c},${r}`);
  return out;
};

// A piece, straight from its definition.
function inPiece(piece, [x, y]) {
  const p = normalizePiece(piece);
  if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1) return false;
  const w = p.x1 - p.x0, h = p.y1 - p.y0;
  const C = { bl: [p.x0, p.y0], br: [p.x1, p.y0], tl: [p.x0, p.y1], tr: [p.x1, p.y1] }[p.corner];
  const O = [p.x0 + p.x1 - C[0], p.y0 + p.y1 - C[1]];
  const u = Math.abs(x - C[0]) / w, v = Math.abs(y - C[1]) / h;
  if (p.shape === "tri") return u + v <= 1;
  if (p.shape === "quarter") return u * u + v * v <= 1;
  const a = Math.abs(x - O[0]) / w, b = Math.abs(y - O[1]) / h;
  return a * a + b * b >= 1; // spandrel
}

function inside(cells, pieces, pt) {
  let ink = cells.has(`${Math.floor(pt[0])},${Math.floor(pt[1])}`);
  for (const p of pieces) {
    if (inPiece(p, pt)) ink = p.mode !== "cut";
  }
  return ink;
}

function check(cellList, pieces) {
  const cells = new Set(cellList);
  const polys = flatten(squareGlyphContours(cellList, { pieces }));
  let checked = 0;
  for (let i = 0; i < 3000; i++) {
    const p = [((i * 0.6180339887) % 1) * 10 - 1, ((i * 0.7548776662 + 0.1) % 1) * 16 - 1];
    // Points right on an edge are skipped: their neighbours disagree.
    const here = inside(cells, pieces, p);
    if ([[0.006, 0], [-0.006, 0], [0, 0.006], [0, -0.006]].some(([dx, dy]) => inside(cells, pieces, [p[0] + dx, p[1] + dy]) !== here)) continue;
    const w = winding(polys, p);
    assert.ok(w === 0 || w === 1, `superposición en ${p} (winding ${w})`);
    assert.equal(w === 1, here, `forma distinta en ${p}`);
    checked++;
  }
  assert.ok(checked > 2500);
}

const K_CELLS = [...block(0, 0, 2, 14), ...block(2, 7, 8, 14)];
const K_PIECES = [
  { x0: 2, y0: 7, x1: 5, y1: 14, corner: "tl", shape: "spandrel", mode: "cut" },
  { x0: 2, y0: 0, x1: 5, y1: 7, corner: "bl", shape: "quarter", mode: "add" },
];

test("the K from the reference: an elliptical arm tangent to the stem", () => {
  check(K_CELLS, K_PIECES);
  const contours = squareGlyphContours(K_CELLS, { pieces: K_PIECES.slice(0, 1) });
  assert.equal(contours.length, 1);
  // The arc comes back as one exact curve, not as many little lines.
  assert.equal(contours[0].filter((c) => c.type === "C").length, 1);
  const expected = 28 + 42 - (21 - (Math.PI * 3 * 7) / 4);
  assert.ok(Math.abs(area(flatten(contours)) - expected) < 0.01);
});

test("diagonals: an A cut out of a block with two triangles", () => {
  const pieces = [
    { x0: 0, y0: 0, x1: 3, y1: 14, corner: "tl", shape: "tri", mode: "cut" },
    { x0: 5, y0: 0, x1: 8, y1: 14, corner: "tr", shape: "tri", mode: "cut" },
  ];
  check(block(0, 0, 8, 14), pieces);
  const contours = squareGlyphContours(block(0, 0, 8, 14), { pieces });
  assert.ok(Math.abs(area(flatten(contours)) - (112 - 42)) < 1e-6);
  assert.equal(contours[0].filter((c) => c.type === "L").length, 3); // a trapezoid: M + 3 lines + close
});

test("pieces apply in order", () => {
  const cut = { x0: 0, y0: 0, x1: 4, y1: 4, corner: "tl", shape: "quarter", mode: "cut" };
  const add = { ...cut, shape: "tri", mode: "add" };
  check(block(0, 0, 4, 4), [cut, add]);
  check(block(0, 0, 4, 4), [add, cut]);
});

test("random drawings with random pieces", () => {
  let seed = 5;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const shapes = ["tri", "quarter", "spandrel"], cornersList = ["bl", "br", "tl", "tr"];
  for (let n = 0; n < 25; n++) {
    const cells = [];
    for (let c = 0; c < 7; c++) for (let r = 0; r < 12; r++) if (rand() < 0.55) cells.push(`${c},${r}`);
    const pieces = [];
    for (let k = 0; k < 1 + Math.floor(rand() * 4); k++) {
      const x0 = Math.floor(rand() * 6), y0 = Math.floor(rand() * 10);
      pieces.push({
        x0, y0, x1: x0 + 1 + Math.floor(rand() * 4), y1: y0 + 1 + Math.floor(rand() * 6),
        corner: cornersList[Math.floor(rand() * 4)], shape: shapes[Math.floor(rand() * 3)],
        mode: rand() < 0.5 ? "cut" : "add",
      });
    }
    check(cells, pieces);
  }
});

test("as an outline the pieces get a band of the stroke width, without overlaps", () => {
  const polys = flatten(squareGlyphContours(K_CELLS, { pieces: K_PIECES, stroke: 0.3 }));
  for (let i = 0; i < 2000; i++) {
    const p = [((i * 0.6180339887) % 1) * 9 - 0.5, ((i * 0.7548776662 + 0.1) % 1) * 15 - 0.5];
    const w = winding(polys, p);
    assert.ok(w === 0 || w === 1, `superposición en ${p}`);
  }
  assert.equal(winding(polys, [1, 3]), 0, "the middle of the stem is hollow");
  assert.equal(winding(polys, [0.1, 3]), 1, "the edge of the stem is ink");
});

test("mirroring a piece flips its corner", () => {
  const p = { x0: 1, y0: 2, x1: 3, y1: 6, corner: "tl", shape: "tri", mode: "cut" };
  assert.deepEqual(mirrorPiece(p, { h: 8 }), { ...p, x0: 5, x1: 7, corner: "tr" });
  assert.deepEqual(mirrorPiece(p, { v: 14 }), { ...p, y0: 8, y1: 12, corner: "bl" });
  assert.equal(pieceContour(p).length, 4);
});

// --- Rounding after the pieces ---
import { pieceGlyphCorners, cornerKey } from "../js/pieces.js";

const A_PIECES = [
  { x0: 0, y0: 0, x1: 2, y1: 14, corner: "tl", shape: "tri", mode: "cut" },
  { x0: 6, y0: 0, x1: 8, y1: 14, corner: "tr", shape: "tri", mode: "cut" },
];

test("corners made by pieces are found where they really are", () => {
  const found = pieceGlyphCorners(block(0, 0, 8, 14), { pieces: A_PIECES });
  const keys = found.map((c) => c.key).sort();
  // The trapezoid: feet at the bottom corners, shoulders where the diagonals end.
  assert.deepEqual(keys, ["0,0", "2,14", "6,14", "8,0"]);
  assert.ok(found.every((c) => c.turn === 1));
});

test("a diagonal corner can be rounded and the rest stays exact", () => {
  const corners = { "2,14": 2 };
  const contours = squareGlyphContours(block(0, 0, 8, 14), { pieces: A_PIECES, corners });
  const polys = flatten(contours);
  const radius = pieceGlyphCorners(block(0, 0, 8, 14), { pieces: A_PIECES, corners }).find((c) => c.key === "2,14").radius;
  assert.ok(Math.abs(radius - 2) < 1e-6);
  assert.equal(winding(polys, [2.02, 13.97]), 0, "the shoulder is rounded off");
  assert.equal(winding(polys, [4, 13.95]), 1, "the top edge further on is untouched");
  assert.equal(contours[0].filter((c) => c.type === "C").length, 1);
  // No little steps: away from the rounded corner, the shape is the trapezoid.
  const cells = new Set(block(0, 0, 8, 14));
  for (let i = 0; i < 2000; i++) {
    const p = [((i * 0.6180339887) % 1) * 9 - 0.5, ((i * 0.7548776662 + 0.1) % 1) * 15 - 0.5];
    if (Math.hypot(p[0] - 2, p[1] - 14) < 4) continue;
    const here = inside(cells, A_PIECES, p);
    if ([[0.006, 0], [-0.006, 0], [0, 0.006], [0, -0.006]].some(([dx, dy]) => inside(cells, A_PIECES, [p[0] + dx, p[1] + dy]) !== here)) continue;
    assert.equal(winding(polys, p) === 1, here, `forma distinta en ${p}`);
  }
});

test("global rounding applies to the final corners, and Shift-sharp corners stay sharp", () => {
  const sharpFeet = { "0,0": 0, "8,0": 0 };
  const polys = flatten(squareGlyphContours(block(0, 0, 8, 14), { pieces: A_PIECES, rounding: 0.4, corners: sharpFeet }));
  assert.equal(winding(polys, [0.03, 0.01]), 1, "foot kept sharp");
  assert.equal(winding(polys, [2.01, 13.99]), 0, "shoulder rounded by the global rounding");
});

test("a big radius stops before eating a counter", () => {
  // A block with a 2×2 hole near its top-left corner, and a triangle piece.
  const cells = block(0, 0, 8, 8).filter((k) => !["2,4", "3,4", "2,5", "3,5"].includes(k));
  const pieces = [{ x0: 6, y0: 0, x1: 8, y1: 3, corner: "br", shape: "tri", mode: "cut" }];
  const corners = { "0,8": "max" };
  const radius = pieceGlyphCorners(cells, { pieces, corners }).find((c) => c.key === "0,8").radius;
  // The arc may reach the hole's corner (2, 6) but not go past it:
  // √2 (r − 2) ≤ r  ⇒  r ≤ 2√2 / (√2 − 1) ≈ 6.83.
  const limit = (2 * Math.SQRT2) / (Math.SQRT2 - 1);
  assert.ok(radius < limit && radius > limit - 0.05, `radio ${radius}`);
  const polys = flatten(squareGlyphContours(cells, { pieces, corners }));
  // The wall beside the hole is still there.
  assert.equal(winding(polys, [1, 2]), 1);
  // The hole stays a separate counter, not joined to the outside.
  assert.equal(polys.length, 2);
  assert.equal(winding(polys, [3, 5]), 0, "the hole");
  for (let i = 0; i < 1500; i++) {
    const p = [((i * 0.6180339887) % 1) * 9 - 0.5, ((i * 0.7548776662 + 0.1) % 1) * 9 - 0.5];
    const w = winding(polys, p);
    assert.ok(w === 0 || w === 1, `superposición en ${p}`);
  }
});

test("random drawings with pieces and rounded corners never overlap", () => {
  let seed = 9;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const shapes = ["tri", "quarter", "spandrel"], cornersList = ["bl", "br", "tl", "tr"];
  for (let n = 0; n < 15; n++) {
    const cells = [];
    for (let c = 0; c < 7; c++) for (let r = 0; r < 10; r++) if (rand() < 0.6) cells.push(`${c},${r}`);
    const pieces = [];
    for (let k = 0; k < 1 + Math.floor(rand() * 3); k++) {
      const x0 = Math.floor(rand() * 6), y0 = Math.floor(rand() * 8);
      pieces.push({ x0, y0, x1: x0 + 1 + Math.floor(rand() * 3), y1: y0 + 1 + Math.floor(rand() * 5),
        corner: cornersList[Math.floor(rand() * 4)], shape: shapes[Math.floor(rand() * 3)], mode: rand() < 0.5 ? "cut" : "add" });
    }
    const corners = {};
    for (const c of pieceGlyphCorners(cells, { pieces })) if (rand() < 0.5) corners[c.key] = rand() < 0.3 ? "max" : [0.5, 1, 2][Math.floor(rand() * 3)];
    const polys = flatten(squareGlyphContours(cells, { pieces, corners, rounding: [0, 0.3][n % 2], stroke: [0, 0.25][Math.floor(n / 2) % 2] }));
    for (let i = 0; i < 1200; i++) {
      const p = [((i * 0.6180339887) % 1) * 9 - 1, ((i * 0.7548776662 + 0.1) % 1) * 12 - 1];
      const w = winding(polys, p);
      assert.ok(w === 0 || w === 1, `superposición en ${p} (dibujo ${n})`);
    }
  }
});

test("corner keys match lattice keys and keep three decimals elsewhere", () => {
  assert.equal(cornerKey(3, 14), "3,14");
  assert.equal(cornerKey(2.33333, 7.5), "2.333,7.5");
});
