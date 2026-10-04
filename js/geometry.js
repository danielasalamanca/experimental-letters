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
