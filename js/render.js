// Builds glyph SVGs for the editor, thumbnails and exports.
// Font units have y up; SVG has y down, so every y is negated here.

import { starPath, joinBridges, parseKey } from "./geometry.js";
import { squareGlyphContours, roundedContours } from "./pieces.js";
import { METRICS, glyphShape, glyphGrid, resolvedCells, resolvedOutline, advanceWidth, layoutText } from "./model.js";
import { outlineToCommands } from "./nodes.js";

export const SVG_NS = "http://www.w3.org/2000/svg";

export const SIDEBEARING_COLOR = "#2f6b5e";
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
  for (const contour of resolvedOutline(font, glyph)) {
    for (const n of contour.nodes) {
      lo = Math.min(lo, Math.floor(n.y));
      hi = Math.max(hi, Math.ceil(n.y));
    }
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
//   preview – only the letter, without guides or labels (same framing)
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

  // Preview (space bar held in the editor): only the letter, same framing.
  if (opts.preview) {
    svg.appendChild(drawShapes(font, resolvedCells(font, glyph), glyphShape(font, glyph), ink, bounds));
    return bounds;
  }

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

  if (guides && glyphGrid(font, glyph) === "squares") {
    // Dot grid, like a dotted notebook: a dot on every cell corner.
    const g = el("g", { opacity: font.view.gridOpacity ?? 1 });
    const lines = el("g", { stroke: "#e2e0da", "stroke-width": 1 });
    for (let c = 0; c <= cols; c++) {
      lines.appendChild(el("line", { x1: c * cu, x2: c * cu, y1: -hi * cu, y2: -lo * cu, "vector-effect": "non-scaling-stroke" }));
    }
    for (let r = lo; r <= hi; r++) {
      lines.appendChild(el("line", { x1: 0, x2: cols * cu, y1: -r * cu, y2: -r * cu, "vector-effect": "non-scaling-stroke" }));
    }
    g.appendChild(lines);
    const dots = el("g", { fill: "#8f8d88" });
    for (let c = 0; c <= cols; c++) {
      for (let r = lo; r <= hi; r++) dots.appendChild(el("circle", { cx: c * cu, cy: -r * cu, r: cu * 0.06 }));
    }
    g.appendChild(dots);
    svg.appendChild(g);
  } else if (guides) {
    const g = el("g", { fill: "none", stroke: "#c8c8c8", "stroke-width": 1, opacity: font.view.gridOpacity ?? 1 });
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
    const layer = drawShapes(font, resolvedCells(font, bg), glyphShape(font, bg), BACKGROUND_COLOR,
      { lo, hi, cols: Math.max(cols, bg.cols) });
    layer.setAttribute("opacity", 0.25);
    svg.appendChild(layer);
  }

  const shape = glyphShape(font, glyph);
  const all = resolvedCells(font, glyph);
  if (components && all.length > glyph.cells.length) {
    // Component cells are drawn lighter so the glyph's own drawing stands out.
    const faint = drawShapes(font, all, shape, ink, bounds);
    faint.setAttribute("opacity", 0.35);
    svg.appendChild(faint);
    svg.appendChild(drawShapes(font, glyph.cells, shape, ink, bounds));
  } else {
    svg.appendChild(drawShapes(font, all, shape, ink, bounds));
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

// The ink. Circle grid: one path per star plus the "unión mínima" bridges.
// Square grid: a single path with the outline of the rounded squares
// (the same contours the .otf uses).
export function drawShapes(font, cellList, { grid, curve, rounding, corners = {}, pieces = [], outline = [] }, ink, { lo, hi, cols }) {
  const cu = font.cell;
  const cells = cellList.filter((k) => {
    const [c, r] = parseKey(k);
    return c >= 0 && c < cols && r >= lo && r < hi;
  });
  const g = el("g", { fill: ink });
  // Outlines edited node by node.
  // Outlines edited node by node, with their live rounded corners.
  if (outline.length) {
    const contours = roundedContours(outlineToCommands(outline), { rounding, corners });
    g.appendChild(el("path", { d: contoursToPath(contours, cu), "fill-rule": "nonzero" }));
  }
  if (grid === "squares") {
    const stroke = font.style === "outline" ? font.stroke / cu : 0;
    if (cells.length) g.appendChild(el("path", { d: contoursToPath(squareGlyphContours(cells, { rounding, stroke, corners, pieces }), cu) }));
    return g;
  }
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

// --- Test text ---
export const KERN_COLOR = "#c4622d";

// Draws `text` set in the font. Each distinct glyph is drawn once in <defs>
// and placed with <use>. Options: size (em in px), ink, paper,
// pair ({ line, index } of the left character of the selected pair).
// Returns the layout so the caller can map clicks to characters.
export function drawText(svg, font, text, { size, ink, paper, pair = null, metrics = false }) {
  const cu = font.cell;
  const m = font.metrics;
  const asc = m.ascender * cu, desc = m.descender * cu;
  const lineHeight = Math.round((asc - desc) * 1.15);
  const pad = cu;
  const layout = layoutText(font, text);
  const w = Math.max(layout.width, cu) + pad * 2;
  const h = layout.lines * lineHeight + pad;
  const top = -asc - pad / 2;
  const scale = size / font.upm;

  svg.setAttribute("viewBox", `${-pad} ${top} ${w} ${h}`);
  svg.setAttribute("width", Math.ceil(w * scale));
  svg.setAttribute("height", Math.ceil(h * scale));
  svg.replaceChildren();
  svg.appendChild(el("rect", { x: -pad, y: top, width: w, height: h, fill: paper }));

  const defs = el("defs");
  const ids = new Map();
  for (const { char, glyph } of layout.items) {
    if (!glyph || ids.has(char)) continue;
    const id = `t${ids.size}`;
    ids.set(char, id);
    const cells = resolvedCells(font, glyph);
    const shapes = drawShapes(font, cells, glyphShape(font, glyph), ink, { lo: -1e6, hi: 1e6, cols: glyph.cols });
    shapes.setAttribute("id", id);
    defs.appendChild(shapes);
  }
  svg.appendChild(defs);

  const lineY = (line) => line * lineHeight;
  if (metrics) {
    // Metric lines across every line of text (for presentations).
    const g = el("g");
    for (let line = 0; line < layout.lines; line++) {
      for (const def of METRICS) {
        const y = lineY(line) - (def.key === "baseline" ? 0 : m[def.key] * cu);
        g.appendChild(el("line", {
          x1: -pad, x2: w - pad, y1: y, y2: y, stroke: def.color,
          "stroke-width": def.key === "baseline" ? 2 : 1, "vector-effect": "non-scaling-stroke",
        }));
      }
    }
    svg.appendChild(g);
  }
  for (const item of layout.items) {
    const y = lineY(item.line);
    if (item.glyph) {
      const use = el("use", { href: `#${ids.get(item.char)}`, x: item.x + item.glyph.lsb, y });
      // xlink:href too, for Illustrator and other older SVG readers.
      use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#${ids.get(item.char)}`);
      svg.appendChild(use);
    } else {
      svg.appendChild(el("rect", {
        x: item.x + cu / 2, y: y - m.capHeight * cu, width: item.advance - cu, height: m.capHeight * cu,
        fill: "none", stroke: ink, "stroke-opacity": 0.4, "stroke-dasharray": "10 8", "stroke-width": cu / 10,
      }));
    }
  }

  // Selected kerning pair: a marker between the two characters.
  const left = pair && layout.items.find((i) => i.line === pair.line && i.index === pair.index);
  if (left) {
    const x = left.x + left.advance + left.kern / 2;
    const y = lineY(left.line);
    svg.appendChild(el("line", {
      x1: x, x2: x, y1: y - asc, y2: y - desc, stroke: KERN_COLOR, "stroke-width": 2, "vector-effect": "non-scaling-stroke",
    }));
    svg.appendChild(el("rect", {
      x: left.x, y: y - asc, width: left.advance + left.kern, height: asc - desc,
      fill: KERN_COLOR, "fill-opacity": 0.06,
    }));
  }

  // Invisible hit areas, one per character.
  for (const item of layout.items) {
    svg.appendChild(el("rect", {
      class: "t-hit", "data-line": item.line, "data-index": item.index,
      x: item.x, y: lineY(item.line) - asc, width: Math.max(item.advance + item.kern, 1), height: asc - desc,
      fill: "transparent",
    }));
  }
  return layout;
}

// Contours in cells (y up) as an SVG path in units (y down).
export function contoursToPath(contours, cu) {
  const n = (v) => Math.round(v * cu * 100) / 100;
  const parts = [];
  for (const contour of contours) {
    for (const c of contour) {
      if (c.type === "M" || c.type === "L") parts.push(`${c.type}${n(c.x)},${n(-c.y)}`);
      else if (c.type === "C") parts.push(`C${n(c.x1)},${n(-c.y1)} ${n(c.x2)},${n(-c.y2)} ${n(c.x)},${n(-c.y)}`);
      else parts.push("Z");
    }
  }
  return parts.join(" ");
}
