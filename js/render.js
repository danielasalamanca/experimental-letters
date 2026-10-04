// Builds glyph SVGs for the editor, thumbnails and exports.
// Font units have y up; SVG has y down, so every y is negated here.

import { starPath, joinBridges, parseKey } from "./geometry.js";
import { METRICS, glyphCurve, resolvedCells, advanceWidth } from "./model.js";

export const SVG_NS = "http://www.w3.org/2000/svg";

export const SIDEBEARING_COLOR = "#0f766e";
export const BACKGROUND_COLOR = "#2f80ed";

const FONT_FAMILY = "ui-sans-serif, system-ui, Helvetica, Arial, sans-serif";

export function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// Area shown for a glyph, in units: rows cover the metric range (widened if
// the drawing goes beyond it, so nothing is ever hidden) and the width
// covers the drawing and both sidebearing lines.
export function glyphBounds(font, glyph) {
  const cu = font.cell;
  let lo = font.metrics.descender, hi = font.metrics.ascender;
  for (const k of resolvedCells(font, glyph)) {
    const [, r] = parseKey(k);
    lo = Math.min(lo, r);
    hi = Math.max(hi, r + 1);
  }
  const right = glyph.cols * cu + glyph.rsb;
  return {
    lo, hi, cols: glyph.cols,
    left: Math.min(-cu / 2, -glyph.lsb) - cu,
    right: Math.max(glyph.cols * cu + cu / 2, right) + cu,
  };
}

const metricRows = (m) => ({ ...m, baseline: 0 });

// Draws `glyph` into `svg`. Options:
//   guides  – circle grid      metrics – metric lines and overshoot zones
//   labels  – metric and sidebearing labels (the drag handles in the editor)
//   components – tint the cells that come from components
//   bounds  – fixed bounds, used to freeze the view while dragging
//   background – another glyph drawn faintly behind (the background layer)
//   frame: "advance" – crop to the advance width and metric range (thumbnails)
export function drawGlyph(svg, font, glyph, opts = {}) {
  const { guides = false, metrics = false, labels = false, components = false } = opts;
  const cu = font.cell;
  const bounds = opts.bounds ?? glyphBounds(font, glyph);
  const { lo, hi, cols } = bounds;
  const { ink, paper } = font.view;
  const m = metricRows(font.metrics);
  const sbLeft = -glyph.lsb, sbRight = glyph.cols * cu + glyph.rsb;

  let x0, x1, top, bottom;
  if (opts.frame === "advance") {
    x0 = sbLeft; x1 = Math.max(sbRight, sbLeft + 1);
    top = -m.ascender * cu; bottom = -m.descender * cu;
  } else {
    const labelPad = labels && metrics ? cu * 4.2 : 0;
    const sbPad = labels ? cu * 0.9 : 0;
    x0 = bounds.left; x1 = bounds.right + labelPad;
    top = -(hi * cu + cu / 2); bottom = -(lo * cu - cu / 2) + sbPad;
  }
  svg.setAttribute("viewBox", `${x0} ${top} ${x1 - x0} ${bottom - top}`);
  svg.replaceChildren();
  svg.appendChild(el("rect", { x: x0, y: top, width: x1 - x0, height: bottom - top, fill: paper }));

  const contentRight = bounds.right ?? x1;
  const gridBottom = -(lo * cu - cu / 2);

  if (metrics) {
    // Rows outside ascender/descender are shaded.
    const out = el("g", { fill: "#000", opacity: 0.04 });
    if (hi > m.ascender) out.appendChild(el("rect", { x: x0, y: top, width: contentRight - x0, height: (hi - m.ascender) * cu + cu / 2 }));
    if (lo < m.descender) out.appendChild(el("rect", { x: x0, y: -m.descender * cu, width: contentRight - x0, height: (m.descender - lo) * cu + cu / 2 }));
    svg.appendChild(out);

    // Overshoot zones: below the baseline, above the x-height and cap height.
    const os = font.overshoot;
    const zones = el("g", { opacity: 0.14 });
    const zone = (y, h, color) => zones.appendChild(el("rect", { x: x0, y: -(y + h), width: contentRight - x0, height: h, fill: color }));
    zone(-os, os, METRICS[3].color);
    zone(m.xHeight * cu, os, METRICS[2].color);
    zone(m.capHeight * cu, os, METRICS[1].color);
    svg.appendChild(zones);
  }

  if (guides) {
    const g = el("g", { fill: "none", stroke: "#c8c8c8", "stroke-width": 1 });
    for (let c = 0; c <= cols; c++) {
      for (let r = lo; r <= hi; r++) {
        g.appendChild(el("rect", { x: c * cu - cu / 2, y: -r * cu - cu / 2, width: cu, height: cu, "vector-effect": "non-scaling-stroke" }));
        g.appendChild(el("circle", { cx: c * cu, cy: -r * cu, r: cu / 2, "vector-effect": "non-scaling-stroke" }));
      }
    }
    svg.appendChild(g);
  }

  if (opts.background) {
    const bg = opts.background;
    const layer = drawShapes(font, resolvedCells(font, bg), glyphCurve(font, bg), BACKGROUND_COLOR,
      { lo, hi, cols: Math.max(cols, bg.cols) });
    layer.setAttribute("opacity", 0.25);
    svg.appendChild(layer);
  }

  const curve = glyphCurve(font, glyph);
  const all = resolvedCells(font, glyph);
  if (components && all.length > glyph.cells.length) {
    // Component cells are drawn lighter so the glyph's own drawing stands out.
    const faint = drawShapes(font, all, curve, ink, bounds);
    faint.setAttribute("opacity", 0.35);
    svg.appendChild(faint);
    svg.appendChild(drawShapes(font, glyph.cells, curve, ink, bounds));
  } else {
    svg.appendChild(drawShapes(font, all, curve, ink, bounds));
  }

  if (metrics) {
    const g = el("g");
    for (const def of METRICS) {
      const y = -m[def.key] * cu;
      g.appendChild(el("line", {
        x1: x0, x2: contentRight + (labels ? cu * 0.3 : 0), y1: y, y2: y,
        stroke: def.color, "stroke-width": def.key === "baseline" ? 2 : 1.25,
        "vector-effect": "non-scaling-stroke",
      }));
      if (labels) {
        const handle = el("g", { class: def.key === "baseline" ? "metric-label" : "metric-label draggable", "data-metric": def.key });
        handle.appendChild(el("rect", { x: contentRight + cu * 0.3, y: y - cu * 0.4, width: cu * 3.8, height: cu * 0.8, rx: cu * 0.15, fill: def.color }));
        handle.appendChild(label(contentRight + cu * 0.5, y, `${def.short} ${m[def.key] * cu}`, cu));
        g.appendChild(handle);
      }
    }
    svg.appendChild(g);
  }

  if (labels) {
    // Sidebearings: vertical lines at the start and end of the advance width.
    const g = el("g");
    for (const [side, x, value] of [["lsb", sbLeft, glyph.lsb], ["rsb", sbRight, glyph.rsb]]) {
      g.appendChild(el("line", {
        x1: x, x2: x, y1: top, y2: gridBottom,
        stroke: SIDEBEARING_COLOR, "stroke-width": 1.25, "stroke-dasharray": "6 4",
        "vector-effect": "non-scaling-stroke",
      }));
      const handle = el("g", { class: "sb-label", "data-sb": side });
      const w = cu * 2.4;
      handle.appendChild(el("rect", { x: x - w / 2, y: gridBottom + cu * 0.1, width: w, height: cu * 0.7, rx: cu * 0.15, fill: SIDEBEARING_COLOR }));
      const t = label(x, gridBottom + cu * 0.45, `${side === "lsb" ? "izq" : "der"} ${value}`, cu);
      t.setAttribute("text-anchor", "middle");
      handle.appendChild(t);
      g.appendChild(handle);
    }
    const adv = label((sbLeft + sbRight) / 2, gridBottom + cu * 0.45, `avance ${advanceWidth(font, glyph)}`, cu);
    adv.setAttribute("text-anchor", "middle");
    adv.setAttribute("fill", SIDEBEARING_COLOR);
    if (sbRight - sbLeft > cu * 6) g.appendChild(adv);
    svg.appendChild(g);
  }
  return bounds;
}

function label(x, y, text, cu) {
  const t = el("text", { x, y, fill: "#fff", "font-size": cu * 0.42, "font-family": FONT_FAMILY, "dominant-baseline": "central" });
  t.textContent = text;
  return t;
}

// The ink: one path per star plus the "unión mínima" bridges.
export function drawShapes(font, cellList, curve, ink, { lo, hi, cols }) {
  const cu = font.cell;
  const cells = cellList.filter((k) => {
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
