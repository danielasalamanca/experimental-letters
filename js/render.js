// Builds glyph SVGs for the editor, thumbnails and exports.
// Font units have y up; SVG has y down, so every y is negated here.

import { starPath, joinBridges, parseKey } from "./geometry.js";
import { METRICS, glyphCurve } from "./model.js";

export const SVG_NS = "http://www.w3.org/2000/svg";

export function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// Rows shown for a glyph: the metric range, widened if the drawing
// goes beyond it so nothing is ever hidden.
export function glyphBounds(font, glyph) {
  let lo = font.metrics.descender, hi = font.metrics.ascender;
  for (const k of glyph.cells) {
    const [, r] = parseKey(k);
    lo = Math.min(lo, r);
    hi = Math.max(hi, r + 1);
  }
  return { lo, hi, cols: glyph.cols };
}

const metricRows = (m) => ({ ...m, baseline: 0 });

// Draws `glyph` into `svg`. Options:
//   guides  – circle grid      metrics – metric lines and overshoot zones
//   labels  – metric labels (also the drag handles in the editor)
//   bounds  – fixed bounds, used to freeze the view while dragging
export function drawGlyph(svg, font, glyph, opts = {}) {
  const { guides = false, metrics = false, labels = false } = opts;
  const cu = font.cell;
  const { lo, hi, cols } = opts.bounds ?? glyphBounds(font, glyph);
  const { ink, paper } = font.view;
  const m = metricRows(font.metrics);

  const labelPad = labels && metrics ? cu * 4.2 : 0;
  const x0 = -cu / 2, x1 = cols * cu + cu / 2 + labelPad;
  const top = -(hi * cu + cu / 2), bottom = -(lo * cu - cu / 2);
  svg.setAttribute("viewBox", `${x0} ${top} ${x1 - x0} ${bottom - top}`);
  svg.replaceChildren();
  svg.appendChild(el("rect", { x: x0, y: top, width: x1 - x0, height: bottom - top, fill: paper }));

  const gridRight = cols * cu + cu / 2;

  if (metrics) {
    // Rows outside ascender/descender are shaded.
    const out = el("g", { fill: "#000", opacity: 0.04 });
    if (hi > m.ascender) out.appendChild(el("rect", { x: x0, y: top, width: gridRight - x0, height: (hi - m.ascender) * cu + cu / 2 }));
    if (lo < m.descender) out.appendChild(el("rect", { x: x0, y: -m.descender * cu, width: gridRight - x0, height: (m.descender - lo) * cu + cu / 2 }));
    svg.appendChild(out);

    // Overshoot zones: below the baseline, above the x-height and cap height.
    const os = font.overshoot;
    const zones = el("g", { opacity: 0.14 });
    const zone = (y, h, color) => zones.appendChild(el("rect", { x: x0, y: -(y + h), width: gridRight - x0, height: h, fill: color }));
    zone(-os, os, METRICS[3].color);
    zone(m.xHeight * cu, os, METRICS[2].color);
    zone(m.capHeight * cu, os, METRICS[1].color);
    svg.appendChild(zones);
  }

  if (guides) {
    const g = el("g", { fill: "none", stroke: "#c8c8c8", "stroke-width": 1, "vector-effect": "non-scaling-stroke" });
    for (let c = 0; c <= cols; c++) {
      for (let r = lo; r <= hi; r++) {
        g.appendChild(el("rect", { x: c * cu - cu / 2, y: -r * cu - cu / 2, width: cu, height: cu, "vector-effect": "non-scaling-stroke" }));
        g.appendChild(el("circle", { cx: c * cu, cy: -r * cu, r: cu / 2, "vector-effect": "non-scaling-stroke" }));
      }
    }
    svg.appendChild(g);
  }

  svg.appendChild(drawShapes(font, glyph, ink, { lo, hi, cols }));

  if (metrics) {
    const g = el("g");
    for (const def of METRICS) {
      const y = -m[def.key] * cu;
      g.appendChild(el("line", {
        x1: x0, x2: gridRight + (labels ? cu * 0.3 : 0), y1: y, y2: y,
        stroke: def.color, "stroke-width": def.key === "baseline" ? 2 : 1.25,
        "vector-effect": "non-scaling-stroke",
      }));
      if (labels) {
        const handle = el("g", { class: def.key === "baseline" ? "metric-label" : "metric-label draggable", "data-metric": def.key });
        handle.appendChild(el("rect", { x: gridRight + cu * 0.3, y: y - cu * 0.4, width: cu * 3.8, height: cu * 0.8, rx: cu * 0.15, fill: def.color }));
        const text = el("text", {
          x: gridRight + cu * 0.5, y, fill: "#fff", "font-size": cu * 0.42,
          "font-family": "ui-sans-serif, system-ui, Helvetica, Arial, sans-serif",
          "dominant-baseline": "central",
        });
        text.textContent = `${def.short} ${m[def.key] * cu}`;
        handle.appendChild(text);
        g.appendChild(handle);
      }
    }
    svg.appendChild(g);
  }
  return { lo, hi, cols };
}

// The ink: one path per star plus the "unión mínima" bridges.
export function drawShapes(font, glyph, ink, { lo, hi, cols }) {
  const cu = font.cell;
  const curve = glyphCurve(font, glyph);
  const cells = glyph.cells.filter((k) => {
    const [c, r] = parseKey(k);
    return c >= 0 && c < cols && r >= lo && r < hi;
  });
  const g = el("g", { fill: ink });
  for (const k of cells) {
    const [c, r] = parseKey(k);
    g.appendChild(el("path", { d: starPath(c * cu, -(r + 1) * cu, cu, curve) }));
  }
  if (font.join.enabled) {
    for (const b of joinBridges(cells, curve, font.join.width / cu)) {
      g.appendChild(el("rect", { x: b.x * cu, y: -(b.y + b.h) * cu, width: b.w * cu, height: b.h * cu }));
    }
  }
  return g;
}
