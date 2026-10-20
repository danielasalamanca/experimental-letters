// Geometry of the grid letters.
//
// Drawing coordinates are in cells with y pointing up and the baseline at 0.
// A filled cell (c, r) is the square [c, c+1] × [r, r+1] minus four circles
// centered on its corners: the concave four-pointed star between circles.
// Circle radius is curve / 2 cells, so curve = 1 makes neighbouring stars
// touch at a single point.

export const key = (c, r) => `${c},${r}`;

export function parseKey(k) {
  const [c, r] = k.split(",").map(Number);
  return [c, r];
}

// SVG path of one star. (x, y) is the top-left corner in SVG coordinates
// (y down) and size is the cell size in the same units.
export function starPath(x, y, size, curve) {
  const r = (size / 2) * curve;
  const L = x, R = x + size, T = y, B = y + size;
  return [
    `M${L + r},${T}`, `L${R - r},${T}`,
    `A${r},${r} 0 0 0 ${R},${T + r}`, `L${R},${B - r}`,
    `A${r},${r} 0 0 0 ${R - r},${B}`, `L${L + r},${B}`,
    `A${r},${r} 0 0 0 ${L},${B - r}`, `L${L},${T + r}`,
    `A${r},${r} 0 0 0 ${L + r},${T}`, "Z",
  ].join(" ");
}

// Width (in cells) of the neck where two side-by-side stars meet.
export const neckWidth = (curve) => 1 - curve;

// "Unión mínima": rectangles that thicken the neck between orthogonal
// neighbours to at least `minWidth` cells. Each rectangle ends exactly where
// the circle arcs are `minWidth` apart, so the outline stays continuous.
// Returns rectangles in cell coordinates (y up): { x, y, w, h }.
export function joinBridges(cells, curve, minWidth) {
  // Capped at 0.8 cells, like the exported outlines (see outline.js).
  const width = Math.min(Math.max(minWidth, 0), 0.8);
  const rho = curve / 2;
  const half = (1 - width) / 2;
  if (width <= 0 || half >= rho) return [];
  const len = Math.sqrt(rho * rho - half * half);

  const set = cells instanceof Set ? cells : new Set(cells);
  const rects = [];
  for (const k of set) {
    const [c, r] = parseKey(k);
    if (set.has(key(c + 1, r))) {
      rects.push({ x: c + 1 - len, y: r + 0.5 - width / 2, w: 2 * len, h: width });
    }
    if (set.has(key(c, r + 1))) {
      rects.push({ x: c + 0.5 - width / 2, y: r + 1 - len, w: width, h: 2 * len });
    }
  }
  return rects;
}

// Nonzero winding of contours (M/L/C/Z commands, in cells) around (x, y):
// not 0 when the point is in their ink. Curves are flattened finely enough
// to pick a part of a letter under the pointer.
export function windingAt(contours, [x, y]) {
  let w = 0;
  const edge = ([x0, y0], [x1, y1]) => {
    const side = (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0);
    if (y0 <= y && y1 > y && side > 0) w++;
    else if (y0 > y && y1 <= y && side < 0) w--;
  };
  for (const cmds of contours) {
    let start = null, cur = null;
    for (const c of cmds) {
      if (c.type === "M") { if (cur && start) edge(cur, start); start = cur = [c.x, c.y]; }
      else if (c.type === "L") { edge(cur, [c.x, c.y]); cur = [c.x, c.y]; }
      else if (c.type === "C") {
        const [x0, y0] = cur;
        let prev = cur;
        for (let i = 1; i <= 16; i++) {
          const t = i / 16, u = 1 - t;
          const p = [
            u * u * u * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
            u * u * u * y0 + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
          ];
          edge(prev, p);
          prev = p;
        }
        cur = [c.x, c.y];
      } else if (c.type === "Z" && cur && start) { edge(cur, start); cur = start; }
    }
    if (cur && start && (cur[0] !== start[0] || cur[1] !== start[1])) edge(cur, start);
  }
  return w;
}
