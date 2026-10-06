// Editor UI: wires the character map, panels and canvas to the font model.

import { key, parseKey } from "./geometry.js";
import {
  METRICS, createGlyph, normalizeFont, createBlankFont, setMetric, sameMetrics,
  GRIDS, glyphGrid, shapeKey, hasOwnShape, resolvedCorners, resolvedPieces, resolvedOutline, glyphShape,
  planFit, applyFit, advanceWidth, resolvedCells, canUseComponent, dependents,
  kerningValue, setKerning, layoutText,
} from "./model.js";
import { GROUPS, CHARSET, glyphName, fileName, codepoint } from "./charset.js";
import { drawGlyph, drawText, el, SVG_NS, contoursToPath } from "./render.js";
import { openLibrary, saveFont, loadFont, deleteFont, newId, fontName } from "./library.js";
import { AXES, axisRows, mirrorKeys, translate, cellsInRect, connectedCells } from "./tools.js";
import { squareCorners, effectiveRadii, MAX_RADIUS } from "./outline.js";
import {
  commandsToOutline, outlineToCommands, cloneOutline, splitSegment, toggleSmooth, deleteNodes,
  nearestSegment, snapToGrid, isSmooth,
} from "./nodes.js";
import { ownContours } from "./shapes.js";
import {
  pieceContour, normalizePiece, mirrorPiece, PIECE_SHAPES, pieceGlyphCorners, cornerKey,
  pieceHandles, movePieceHandle,
} from "./pieces.js";


const $ = (id) => document.getElementById(id);
const board = $("board");

// Falls back to an in-memory store if the browser blocks localStorage.
const storage = (() => {
  try {
    const s = window.localStorage;
    s.getItem("x");
    return s;
  } catch {
    const mem = new Map();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  }
})();

const opened = openLibrary(storage);
let library = opened.index;
let font = normalizeFont(opened.data);
const glyph = () => font.glyphs[font.active];

// --- Storage: the open font is saved to the library on every change ---
let lastSaved = null, saveFailed = false;

function persist() {
  if (saveFont(storage, library, font)) {
    lastSaved = new Date();
    saveFailed = false;
  } else if (!saveFailed) {
    saveFailed = true;
    toast("No se pudo guardar en el navegador (¿sin espacio?). Descarga el .json para no perder cambios.");
  }
  syncLibrary();
}

// --- Undo / redo: whole-font snapshots, coalesced per control ---
const undoStack = [], redoStack = [];
let lastTag = null, lastTime = 0;

function checkpoint(tag = null) {
  const now = Date.now();
  if (tag && tag === lastTag && now - lastTime < 1000) { lastTime = now; return; }
  lastTag = tag; lastTime = now;
  undoStack.push(JSON.stringify(font));
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}

function restore(from, to) {
  const snap = from.pop();
  if (!snap) return;
  to.push(JSON.stringify(font));
  font = normalizeFont(JSON.parse(snap));
  lastTag = null;
  refreshAll();
}
const undo = () => restore(undoStack, redoStack);
const redo = () => restore(redoStack, undoStack);

// --- Rendering ---
let bounds = null;       // what the canvas currently shows
let frozenBounds = null; // kept fixed while dragging so the view doesn't jump
let fitBox = null;       // viewBox that fits the whole glyph
let zoomBox = null;      // explicit viewBox while zoomed or panned; null = fit

// Redraws the canvas. `scope` says which thumbnails are stale:
// "glyph" = the active glyph and the composites using it, "font" = all.
function render(scope = "glyph") {
  const bgChar = font.view.background;
  bounds = drawGlyph(board, font, glyph(), {
    guides: font.view.guides,
    metrics: font.view.metrics,
    labels: true,
    components: true,
    bounds: frozenBounds,
    background: bgChar && bgChar !== font.active ? font.glyphs[bgChar] : null,
    preview: spaceDown,
  });
  const vb = board.viewBox.baseVal;
  fitBox = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
  if (zoomBox) board.setAttribute("viewBox", `${zoomBox.x} ${zoomBox.y} ${zoomBox.w} ${zoomBox.h}`);
  if (!spaceDown) decorate();
  $("zoomLevel").textContent = Math.round((fitBox.w / (zoomBox ?? fitBox).w) * 100) + "%";
  updateInfo();
  if (scope === "font") renderCharmap();
  else if (scope === "glyph") dependents(font, font.active).forEach(updateThumb);
  if (scope) scheduleTest();
  persist();
}

function refreshAll() {
  selection.clear();
  nodeSel.clear();
  syncControls();
  render("font");
  renderGallery();
}

// Editor-only overlay: mirror axes, selection and the selection rectangle.
function decorate() {
  const cu = font.cell;
  const g = glyph();
  const own = new Set(g.cells);
  for (const k of [...selection]) if (!own.has(k)) selection.delete(k);

  const layer = el("g", { "pointer-events": "none" });
  const top = -bounds.hi * cu, bottom = -bounds.lo * cu;
  const axisStyle = { stroke: "#d6249f", "stroke-width": 1.5, "stroke-dasharray": "8 5", "vector-effect": "non-scaling-stroke" };
  if (font.view.mirrorH) {
    const x = (g.cols * cu) / 2;
    layer.appendChild(el("line", { x1: x, x2: x, y1: top, y2: bottom, ...axisStyle }));
  }
  if (font.view.mirrorV) {
    const [lo, hi] = axisRows(font.view.mirrorAxis, font.metrics, font.active);
    const y = -((lo + hi) / 2) * cu;
    layer.appendChild(el("line", { x1: 0, x2: g.cols * cu, y1: y, y2: y, ...axisStyle }));
  }
  for (const k of selection) {
    const [c, r] = parseKey(k);
    layer.appendChild(el("rect", {
      x: c * cu, y: -(r + 1) * cu, width: cu, height: cu,
      fill: "#2f80ed", "fill-opacity": 0.18, stroke: "#2f80ed", "stroke-width": 1, "vector-effect": "non-scaling-stroke",
    }));
  }
  if (tool === "corner") drawCornerMarkers(layer);
  if (tool === "piece") drawPieceMarkers(layer);
  if (tool === "nodes") drawNodeMarkers(layer);
  if (action?.type === "marquee" && action.moved) {
    const { x0, y0, x1, y1 } = action;
    layer.appendChild(el("rect", {
      x: Math.min(x0, x1) * cu, y: -Math.max(y0, y1) * cu,
      width: Math.abs(x1 - x0) * cu, height: Math.abs(y1 - y0) * cu,
      fill: "#2f80ed", "fill-opacity": 0.06, stroke: "#2f80ed", "stroke-dasharray": "4 3",
      "vector-effect": "non-scaling-stroke",
    }));
  }
  board.appendChild(layer);
}

let toastTimer = null;
function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

// A glyph with nothing drawn: no cells and no node outline (own or from components).
const isEmptyGlyph = (g) => resolvedCells(font, g).length === 0 && resolvedOutline(font, g).length === 0;

// --- Character map ---
const thumbs = new Map(); // char -> cell element

function renderCharmap() {
  const map = $("charmap");
  if (!thumbs.size) {
    for (const group of GROUPS) {
      const h = document.createElement("h2");
      h.textContent = group.name;
      const grid = document.createElement("div");
      grid.className = "cm-grid";
      for (const char of group.chars) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cm-cell";
        cell.dataset.char = char;
        cell.addEventListener("click", () => selectGlyph(char));
        thumbs.set(char, cell);
        grid.appendChild(cell);
      }
      map.append(h, grid);
    }
  }
  CHARSET.forEach(updateThumb);
}

function updateThumb(char) {
  const cell = thumbs.get(char);
  const g = font.glyphs[char];
  if (!cell || !g) return;
  const empty = isEmptyGlyph(g);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  drawGlyph(svg, font, g, { frame: "advance" });
  const label = document.createElement("span");
  label.className = "cm-label";
  label.textContent = char === " " ? "esp" : char;
  cell.replaceChildren(svg, label);
  if (hasOwnShape(font, g)) cell.appendChild(marker("own-dot", "Usa curvatura o redondeo propio"));
  if (g.grid != null) cell.appendChild(marker("grid-mark", `Grilla propia: ${GRIDS[g.grid]}`));
  if (g.outline) cell.appendChild(marker("node-mark", "Editada con nodos"));
  if (g.components.length) cell.appendChild(marker("comp-mark", "Compuesto con componentes"));
  cell.classList.toggle("empty", empty);
  cell.classList.toggle("active", char === font.active);
  cell.title = `${glyphName(char)} · ${codepoint(char)}`;
}

function marker(className, title) {
  const m = document.createElement("span");
  m.className = className;
  m.title = title;
  return m;
}

function selectGlyph(char) {
  const prev = font.active;
  selection.clear();
  nodeSel.clear();
  font.active = char;
  updateThumb(prev);
  updateThumb(char);
  thumbs.get(char)?.scrollIntoView({ block: "nearest" });
  syncControls();
  render(null);
}

// --- Drafts (the old "Mis letras") ---
function renderGallery() {
  const gallery = $("gallery");
  gallery.replaceChildren();
  font.drafts.forEach((draft, i) => {
    const item = document.createElement("div");
    item.className = "thumb";
    item.title = "Clic para copiar al glifo actual · doble clic para borrar";
    const svg = document.createElementNS(SVG_NS, "svg");
    drawGlyph(svg, font, draft, { frame: "advance" });
    item.appendChild(svg);
    if (hasOwnShape(font, draft)) item.appendChild(marker("own-dot", "Usa curvatura o redondeo propio"));
    item.addEventListener("click", () => {
      checkpoint();
      const { lsb, rsb } = glyph();
      font.glyphs[font.active] = createGlyph({ ...draft, lsb, rsb, components: [] });
      selection.clear();
      syncControls();
      render();
    });
    item.addEventListener("dblclick", () => {
      checkpoint();
      font.drafts.splice(i, 1);
      renderGallery();
      persist();
    });
    gallery.appendChild(item);
  });
}

// --- Tools and pointer ---
let tool = "draw";           // "draw" | "select"
const selection = new Set(); // selected own cells (never saved)
let clipboard = null;
let action = null;           // the drag in progress
let spaceDown = false;

function setTool(next) {
  // A glyph edited with nodes has no grid drawing to work on.
  if (glyph().outline && ["draw", "select", "corner", "piece"].includes(next)) {
    if (tool === "nodes") toast("Esta letra se edita con nodos. Para dibujar en la grilla, usa «Volver a la grilla» en el panel Glifo.");
    next = "nodes";
  }
  // Corners and pieces only exist on the square grid.
  if ((next === "corner" || next === "piece") && glyphGrid(font, glyph()) !== "squares") {
    toast(`La herramienta ${next === "corner" ? "Esquinas" : "Piezas"} funciona con la grilla de puntos (cuadrados).`);
    next = tool === "corner" || tool === "piece" ? "draw" : tool;
  }
  tool = next;
  if (tool !== "select") selection.clear();
  if (tool !== "piece") selectedPiece = null;
  if (tool !== "nodes") nodeSel.clear();
  $("toolNodes").classList.toggle("active", tool === "nodes");
  $("toolPiece").classList.toggle("active", tool === "piece");
  $("pieceGroup").hidden = tool !== "piece";
  $("toolDraw").classList.toggle("active", tool === "draw");
  $("toolSelect").classList.toggle("active", tool === "select");
  $("toolCorner").classList.toggle("active", tool === "corner");
  $("cornerGroup").hidden = tool !== "corner";
  board.dataset.tool = tool;
  render(null);
}

function toUnits(evt) {
  const p = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(board.getScreenCTM().inverse());
  return { x: p.x, y: -p.y };
}

// Pointer position in cells (fractional).
function toCells(evt) {
  const { x, y } = toUnits(evt);
  return { x: x / font.cell, y: y / font.cell };
}

const inBounds = (c, r) => c >= 0 && c < bounds.cols && r >= bounds.lo && r < bounds.hi;

function cellAt(evt) {
  const { x, y } = toCells(evt);
  const c = Math.floor(x), r = Math.floor(y);
  return inBounds(c, r) ? key(c, r) : null;
}

// Paints (or erases) a cell and its mirror images.
function paint(k, adding) {
  const g = glyph();
  const targets = mirrorKeys(k, {
    h: font.view.mirrorH, v: font.view.mirrorV, cols: g.cols,
    rows: axisRows(font.view.mirrorAxis, font.metrics, font.active),
  }).filter((t) => inBounds(...parseKey(t)));
  const cells = new Set(g.cells);
  const before = cells.size;
  for (const t of targets) adding ? cells.add(t) : cells.delete(t);
  if (cells.size === before) return;
  g.cells = [...cells];
  render();
}

board.addEventListener("pointerdown", (evt) => {
  if (evt.button === 1 || (evt.button === 0 && spaceDown)) {
    evt.preventDefault();
    const box = zoomBox ?? fitBox;
    action = { type: "pan", sx: evt.clientX, sy: evt.clientY, box: { ...box }, scale: board.getScreenCTM().a };
    board.classList.add("panning");
    return;
  }
  if (evt.button !== 0) return;
  frozenBounds = bounds;
  const metric = evt.target.closest?.(".metric-label.draggable");
  const side = evt.target.closest?.(".sb-label");
  if (metric || side) {
    checkpoint();
    action = metric ? { type: "metric", metric: metric.dataset.metric } : { type: "side", side: side.dataset.sb };
    return;
  }
  const g = glyph();
  const k = cellAt(evt);

  if (tool === "corner") {
    frozenBounds = null;
    startCorner(evt);
    return;
  }

  if (tool === "nodes") {
    frozenBounds = null;
    startNodeAction(evt);
    return;
  }

  if (tool === "piece") {
    const node = nodeAt(evt);
    if (node) {
      checkpoint();
      selectedPiece = node.index;
      action = { type: "node", ...node, shift: evt.shiftKey };
      syncPieceList();
      return;
    }
    const { x, y } = toCells(evt);
    action = { type: "piece", x0: Math.round(x), y0: Math.round(y), x1: Math.round(x), y1: Math.round(y), moved: false, at: { x, y } };
    return;
  }

  if (tool === "draw") {
    if (!k) { frozenBounds = null; return; }
    checkpoint();
    // An empty glyph is always drawn against the current metrics.
    if (g.cells.length === 0) g.metrics = { ...font.metrics };
    action = { type: "paint", adding: !g.cells.includes(k) };
    paint(k, action.adding);
    return;
  }

  // Select tool: drag a selected cell to move the selection,
  // otherwise drag a rectangle (or click a cell) to select.
  const p = toCells(evt);
  if (k && selection.has(k) && !evt.shiftKey) {
    checkpoint();
    const moving = [...selection];
    action = {
      type: "move", sx: Math.floor(p.x), sy: Math.floor(p.y), dc: 0, dr: 0, moving,
      rest: g.cells.filter((x) => !selection.has(x)),
    };
    return;
  }
  action = { type: "marquee", x0: p.x, y0: p.y, x1: p.x, y1: p.y, moved: false, additive: evt.shiftKey, cell: k };
});

window.addEventListener("pointermove", (evt) => {
  if (!action) return;
  const g = glyph();
  switch (action.type) {
    case "pan": {
      const { box, sx, sy, scale } = action;
      zoomBox = { ...box, x: box.x - (evt.clientX - sx) / scale, y: box.y - (evt.clientY - sy) / scale };
      render(null);
      break;
    }
    case "metric": {
      const rows = Math.round(toUnits(evt).y / font.cell);
      const next = setMetric(font.metrics, action.metric, Math.min(bounds.hi, Math.max(bounds.lo, rows)));
      if (!sameMetrics(next, font.metrics)) {
        font.metrics = next;
        syncMetricInputs();
        render(null);
      }
      break;
    }
    case "side": {
      // Sidebearings snap to tenths of a cell while dragging.
      const step = font.cell / 10;
      const x = Math.min(bounds.right, Math.max(bounds.left, toUnits(evt).x));
      const value = action.side === "lsb"
        ? Math.round(-x / step) * step
        : Math.round((x - g.cols * font.cell) / step) * step;
      if (value !== g[action.side]) {
        g[action.side] = value;
        syncGlyphPanel();
        render();
      }
      break;
    }
    case "corner": {
      dragCorner(evt);
      break;
    }
    case "node": {
      dragNode(evt);
      break;
    }
    case "nodes":
    case "handle":
    case "nodeMarquee": {
      moveNodeAction(evt);
      break;
    }
    case "piece": {
      const { x, y } = toCells(evt);
      const x1 = Math.round(x), y1 = Math.round(y);
      if (x1 !== action.x1 || y1 !== action.y1) {
        action.x1 = x1; action.y1 = y1;
        action.moved = x1 !== action.x0 || y1 !== action.y0;
        render(null);
      }
      break;
    }
    case "paint": {
      const k = cellAt(evt);
      if (k) paint(k, action.adding);
      break;
    }
    case "move": {
      const p = toCells(evt);
      const dc = Math.floor(p.x) - action.sx, dr = Math.floor(p.y) - action.sy;
      if (dc === action.dc && dr === action.dr) break;
      action.dc = dc; action.dr = dr;
      const moved = translate(action.moving, dc, dr);
      g.cells = [...new Set([...action.rest, ...moved])];
      selection.clear();
      moved.forEach((k) => selection.add(k));
      render();
      break;
    }
    case "marquee": {
      const p = toCells(evt);
      action.x1 = p.x; action.y1 = p.y;
      action.moved ||= Math.hypot(action.x1 - action.x0, action.y1 - action.y0) > 0.3;
      render(null);
      break;
    }
  }
});

window.addEventListener("pointerup", () => {
  if (!action) return;
  const done = action;
  action = null;
  frozenBounds = null;
  board.classList.remove("panning");
  if (done.type === "marquee") {
    const own = glyph().cells;
    if (!done.additive) selection.clear();
    if (done.moved) {
      cellsInRect(own, done.x0, done.y0, done.x1, done.y1).forEach((k) => selection.add(k));
    } else if (done.cell && own.includes(done.cell)) {
      if (done.additive && selection.has(done.cell)) selection.delete(done.cell);
      else selection.add(done.cell);
    }
    render(null);
    return;
  }
  if (done.type === "pan") return;
  if (done.type === "corner") { endCorner(done); return; }
  if (done.type === "piece") { endPiece(done); return; }
  if (done.type === "node") { render(); syncPieceList(); return; }
  if (["nodes", "handle", "nodeMarquee"].includes(done.type)) { endNodeAction(done); return; }
  render(done.type === "metric" ? "font" : "glyph");
});

// --- Node tool (like Illustrator's direct selection) ---
// Shows the anchor points of the glyph's real outline. The first time a
// node is moved (or added, deleted, converted), the glyph's own drawing is
// turned into an editable outline; "Volver a la grilla" undoes that.
const NODE_COLOR = "#1473e6";
const nodeSel = new Set(); // "contour:node"

// The outline being edited: the glyph's own, or a preview of what its
// drawing would become.
function editableOutline() {
  const g = glyph();
  return g.outline ?? commandsToOutline(ownContours(font, g));
}

function ensureOutline() {
  const g = glyph();
  if (g.outline) return g.outline;
  g.outline = commandsToOutline(ownContours(font, g));
  toast("La letra ahora se edita con nodos. «Volver a la grilla» (panel Glifo) la devuelve a la grilla.");
  syncGlyphPanel();
  return g.outline;
}

// Pointer tolerance: a few screen pixels, in cells.
const pxToCells = (px) => px / (board.getScreenCTM().a * font.cell);

function nodeHit(outline, p, tol) {
  let best = null, bestDist = tol;
  outline.forEach((c, ci) => c.nodes.forEach((n, ni) => {
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d < bestDist) { best = `${ci}:${ni}`; bestDist = d; }
  }));
  return best;
}

function handleHit(outline, p, tol) {
  for (const k of nodeSel) {
    const [ci, ni] = k.split(":").map(Number);
    const n = outline[ci]?.nodes[ni];
    if (!n) continue;
    for (const which of ["in", "out"]) {
      if (n[which] && Math.hypot(n.x + n[which][0] - p.x, n.y + n[which][1] - p.y) < tol) return { ci, ni, which };
    }
  }
  return null;
}

const nodeAtKey = (outline, k) => {
  const [ci, ni] = k.split(":").map(Number);
  return outline[ci]?.nodes[ni];
};

// Nodes mirroring the given ones (with the mirror tools on), and how a
// movement maps onto them.
function nodePartners(outline, keys) {
  const g = glyph();
  const [lo, hi] = axisRows(font.view.mirrorAxis, font.metrics, font.active);
  const maps = [];
  if (font.view.mirrorH) maps.push({ pos: (x, y) => [g.cols - x, y], vec: ([dx, dy]) => [-dx, dy] });
  if (font.view.mirrorV) maps.push({ pos: (x, y) => [x, lo + hi - y], vec: ([dx, dy]) => [dx, -dy] });
  if (font.view.mirrorH && font.view.mirrorV) maps.push({ pos: (x, y) => [g.cols - x, lo + hi - y], vec: ([dx, dy]) => [-dx, -dy] });
  const taken = new Set(keys);
  const out = [];
  for (const k of keys) {
    const n = nodeAtKey(outline, k);
    for (const m of maps) {
      const [mx, my] = m.pos(n.x, n.y);
      const hit = nodeHit(outline, { x: mx, y: my }, 1e-6);
      if (hit && !taken.has(hit)) { taken.add(hit); out.push({ key: hit, of: k, vec: m.vec }); }
    }
  }
  return out;
}

function startNodeAction(evt) {
  const p = toCells(evt);
  const outline = editableOutline();
  const tol = pxToCells(8);
  const h = handleHit(outline, p, tol);
  if (h) {
    checkpoint();
    const n = outline[h.ci].nodes[h.ni];
    const partners = nodePartners(outline, [`${h.ci}:${h.ni}`]).map((pt) => {
      // Which handle of the mirrored node mirrors this one.
      const pn = nodeAtKey(outline, pt.key);
      const target = pt.vec(n[h.which]);
      const dist = (v) => (v ? Math.hypot(v[0] - target[0], v[1] - target[1]) : Infinity);
      return { ...pt, which: dist(pn.in) <= dist(pn.out) ? "in" : "out" };
    });
    action = { type: "handle", ...h, smooth: isSmooth(n), partners };
    return;
  }
  const k = nodeHit(outline, p, tol);
  if (k) {
    if (evt.shiftKey) {
      if (nodeSel.has(k)) nodeSel.delete(k); else nodeSel.add(k);
    } else if (!nodeSel.has(k)) {
      nodeSel.clear();
      nodeSel.add(k);
    }
    checkpoint();
    const keys = [...nodeSel];
    action = {
      type: "nodes", key: k, start: p, keys, moved: false,
      partners: nodePartners(outline, keys),
      orig: cloneOutline(outline),
    };
    render(null);
    return;
  }
  action = { type: "nodeMarquee", x0: p.x, y0: p.y, x1: p.x, y1: p.y, moved: false, additive: evt.shiftKey };
}

function moveNodeAction(evt) {
  const p = toCells(evt);
  if (action.type === "nodeMarquee") {
    action.x1 = p.x; action.y1 = p.y;
    action.moved ||= Math.hypot(p.x - action.x0, p.y - action.y0) > pxToCells(4);
    render(null);
    return;
  }
  if (action.type === "handle") {
    const outline = ensureOutline();
    const n = outline[action.ci].nodes[action.ni];
    let v = [p.x - n.x, p.y - n.y];
    if (evt.shiftKey) v = constrain(v);
    n[action.which] = v;
    // A smooth node keeps both handles in line (Alt breaks them apart).
    const other = action.which === "in" ? "out" : "in";
    if (action.smooth && !evt.altKey && n[other]) {
      const len = Math.hypot(...n[other]), lv = Math.hypot(...v) || 1;
      n[other] = [-v[0] / lv * len, -v[1] / lv * len];
    }
    for (const pt of action.partners) {
      const pn = nodeAtKey(outline, pt.key);
      pn[pt.which] = pt.vec(n[action.which]);
      const po = pt.which === "in" ? "out" : "in";
      if (n[other] && pn[po]) pn[po] = pt.vec(n[other]);
    }
    render();
    return;
  }
  // Moving nodes: the grabbed node snaps to the grid (Alt: no snapping),
  // Shift keeps the move horizontal, vertical or diagonal.
  let d = [p.x - action.start.x, p.y - action.start.y];
  if (!action.moved && Math.hypot(...d) < pxToCells(3)) return;
  if (evt.shiftKey) d = constrain(d);
  const grabbed = nodeAtKey(action.orig, action.key);
  if (!evt.altKey) {
    const target = snapToGrid([grabbed.x + d[0], grabbed.y + d[1]]);
    d = [target[0] - grabbed.x, target[1] - grabbed.y];
  }
  action.moved = true;
  const outline = ensureOutline();
  const place = (k, [dx, dy]) => {
    const o = nodeAtKey(action.orig, k), n = nodeAtKey(outline, k);
    n.x = o.x + dx;
    n.y = o.y + dy;
  };
  for (const k of action.keys) place(k, d);
  for (const pt of action.partners) place(pt.key, pt.vec(d));
  render();
}

function endNodeAction(done) {
  if (done.type === "nodeMarquee") {
    if (!done.additive) nodeSel.clear();
    if (done.moved) {
      const [ax, bx] = [Math.min(done.x0, done.x1), Math.max(done.x0, done.x1)];
      const [ay, by] = [Math.min(done.y0, done.y1), Math.max(done.y0, done.y1)];
      editableOutline().forEach((c, ci) => c.nodes.forEach((n, ni) => {
        if (n.x >= ax && n.x <= bx && n.y >= ay && n.y <= by) nodeSel.add(`${ci}:${ni}`);
      }));
    }
    render(null);
    return;
  }
  render("glyph");
}

// Shift: snap a vector to multiples of 45°.
function constrain([dx, dy]) {
  const len = Math.hypot(dx, dy);
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return [Math.cos(a) * len, Math.sin(a) * len];
}

// Double-click: on a node, corner ↔ smooth; on a segment, a new node.
function nodeDoubleClick(evt) {
  const p = toCells(evt);
  const tol = pxToCells(8);
  const preview = editableOutline();
  const k = nodeHit(preview, p, tol);
  if (k) {
    checkpoint();
    const outline = ensureOutline();
    const [ci, ni] = k.split(":").map(Number);
    toggleSmooth(outline, ci, ni);
    render();
    return;
  }
  const seg = nearestSegment(preview, [p.x, p.y]);
  if (seg && seg.dist < tol) {
    checkpoint();
    const outline = ensureOutline();
    const ni = splitSegment(outline, seg.contour, seg.index, seg.t);
    nodeSel.clear();
    nodeSel.add(`${seg.contour}:${ni}`);
    render();
  }
}

function deleteSelectedNodes() {
  if (!nodeSel.size) return;
  checkpoint();
  const g = glyph();
  ensureOutline();
  g.outline = deleteNodes(g.outline, [...nodeSel]);
  nodeSel.clear();
  render();
}

function nudgeNodes(dx, dy) {
  if (!nodeSel.size) return;
  checkpoint("nudgeNodes");
  const outline = ensureOutline();
  const keys = [...nodeSel];
  for (const k of keys) { const n = nodeAtKey(outline, k); n.x += dx; n.y += dy; }
  for (const pt of nodePartners(outline, keys)) {
    const n = nodeAtKey(outline, pt.key);
    const [mx, my] = pt.vec([dx, dy]);
    n.x += mx; n.y += my;
  }
  render();
}

function drawNodeMarkers(layer) {
  const cu = font.cell;
  const outline = editableOutline();
  const px = 1 / board.getScreenCTM().a; // one screen pixel, in units
  layer.appendChild(el("path", {
    d: contoursToPath(outlineToCommands(outline), cu), fill: "none", stroke: NODE_COLOR,
    "stroke-width": 1.5, "vector-effect": "non-scaling-stroke",
  }));
  outline.forEach((c, ci) => c.nodes.forEach((n, ni) => {
    const selected = nodeSel.has(`${ci}:${ni}`);
    if (selected) {
      for (const which of ["in", "out"]) {
        if (!n[which]) continue;
        const hx = (n.x + n[which][0]) * cu, hy = -(n.y + n[which][1]) * cu;
        layer.appendChild(el("line", { x1: n.x * cu, y1: -n.y * cu, x2: hx, y2: hy, stroke: NODE_COLOR, "stroke-width": 1, "vector-effect": "non-scaling-stroke" }));
        layer.appendChild(el("circle", { cx: hx, cy: hy, r: 4 * px, fill: NODE_COLOR }));
      }
    }
    const size = 7 * px;
    layer.appendChild(el("rect", {
      x: n.x * cu - size / 2, y: -n.y * cu - size / 2, width: size, height: size,
      fill: selected ? NODE_COLOR : "#fff", stroke: NODE_COLOR, "stroke-width": 1.2, "vector-effect": "non-scaling-stroke",
    }));
  }));
  if (action?.type === "nodeMarquee" && action.moved) {
    const { x0, y0, x1, y1 } = action;
    layer.appendChild(el("rect", {
      x: Math.min(x0, x1) * cu, y: -Math.max(y0, y1) * cu, width: Math.abs(x1 - x0) * cu, height: Math.abs(y1 - y0) * cu,
      fill: NODE_COLOR, "fill-opacity": 0.06, stroke: NODE_COLOR, "stroke-dasharray": "4 3", "vector-effect": "non-scaling-stroke",
    }));
  }
}

// --- Piece tool (square grid) ---
let pieceMode = "cut";
let selectedPiece = null; // index in the glyph's own pieces

const PIECE_COLOR = "#0f766e";

// A drag from one lattice point to another places a piece; the corner where
// the drag starts is the piece's corner (right angle, or centre of the
// quarter ellipse). A click on a piece selects it.
function endPiece(done) {
  const g = glyph();
  if (!done.moved || done.x0 === done.x1 || done.y0 === done.y1) {
    const { x, y } = done.at;
    const hit = g.pieces.map((p, i) => [normalizePiece(p), i])
      .filter(([p]) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1)
      .map(([, i]) => i).pop();
    selectedPiece = hit ?? null;
    render(null);
    syncPieceList();
    return;
  }
  checkpoint();
  const piece = normalizePiece({
    x0: done.x0, y0: done.y0, x1: done.x1, y1: done.y1,
    corner: (done.y0 <= done.y1 ? "b" : "t") + (done.x0 <= done.x1 ? "l" : "r"),
    shape: $("pieceShape").value, mode: pieceMode,
  });
  const [lo, hi] = axisRows(font.view.mirrorAxis, font.metrics, font.active);
  const placed = [piece];
  if (font.view.mirrorH) placed.push(...placed.map((p) => mirrorPiece(p, { h: g.cols })));
  if (font.view.mirrorV) placed.push(...placed.map((p) => mirrorPiece(p, { v: lo + hi })));
  g.pieces.push(...placed);
  selectedPiece = g.pieces.length - placed.length;
  render();
  syncPieceList();
}

// --- Moving piece nodes ---
// The node under the pointer: the piece, which node, and the nodes of its
// mirror images (pieces placed with the mirror), which move along with it.
function nodeAt(evt) {
  const { x, y } = toCells(evt);
  const pieces = glyph().pieces;
  let best = null, bestDist = 0.35;
  // The selected piece wins when nodes overlap.
  const order = [...pieces.keys()].sort((a, b) => (b === selectedPiece) - (a === selectedPiece));
  for (const index of order) {
    for (const h of pieceHandles(pieces[index])) {
      const dist = Math.hypot(x - h.x, y - h.y);
      if (dist < bestDist) { best = { index, id: h.id }; bestDist = dist; }
    }
  }
  if (!best) return null;
  return { ...best, partners: mirrorPartners(best.index) };
}

function mirrorPartners(index) {
  const g = glyph();
  const p = g.pieces[index];
  const [lo, hi] = axisRows(font.view.mirrorAxis, font.metrics, font.active);
  const same = (a, b) => JSON.stringify(normalizePiece(a)) === JSON.stringify(normalizePiece(b));
  const out = [];
  const options = [];
  if (font.view.mirrorH) options.push({ h: g.cols, map: ([x, y]) => [g.cols - x, y] });
  if (font.view.mirrorV) options.push({ v: lo + hi, map: ([x, y]) => [x, lo + hi - y] });
  if (font.view.mirrorH && font.view.mirrorV) options.push({ h: g.cols, v: lo + hi, map: ([x, y]) => [g.cols - x, lo + hi - y] });
  for (const opt of options) {
    const image = mirrorPiece(p, opt);
    const j = g.pieces.findIndex((q, k) => k !== index && same(q, image));
    if (j >= 0) out.push({ index: j, map: opt.map });
  }
  return out;
}

function dragNode(evt) {
  const { x, y } = toCells(evt);
  // Nodes snap to grid points; with Shift, to half cells.
  const step = evt.shiftKey ? 0.5 : 1;
  const at = [Math.round(x / step) * step, Math.round(y / step) * step];
  const g = glyph();
  const moved = movePieceHandle(g.pieces[action.index], action.id, at);
  if (!moved) return;
  const before = JSON.stringify(g.pieces[action.index]);
  const partners = action.partners.map((p) => [p.index, movePieceHandle(g.pieces[p.index], action.id, p.map(at))]);
  if (JSON.stringify(moved) === before || partners.some(([, q]) => !q)) return;
  g.pieces[action.index] = moved;
  for (const [j, q] of partners) g.pieces[j] = q;
  render();
}

function removePiece(index) {
  checkpoint();
  glyph().pieces.splice(index, 1);
  selectedPiece = null;
  render();
  syncPieceList();
}

function drawPieceMarkers(layer) {
  const cu = font.cell;
  if (selectedPiece !== null && selectedPiece >= glyph().pieces.length) selectedPiece = null;
  glyph().pieces.forEach((p, i) => {
    const n = normalizePiece(p);
    const selected = i === selectedPiece;
    layer.appendChild(el("rect", {
      x: n.x0 * cu, y: -n.y1 * cu, width: (n.x1 - n.x0) * cu, height: (n.y1 - n.y0) * cu,
      fill: "none", stroke: PIECE_COLOR, "stroke-width": selected ? 2.5 : 1, "stroke-dasharray": selected ? "" : "5 4",
      "vector-effect": "non-scaling-stroke",
    }));
    if (selected) {
      layer.appendChild(el("path", {
        d: contoursToPath([pieceContour(n)], cu), fill: PIECE_COLOR, "fill-opacity": 0.18,
        stroke: PIECE_COLOR, "stroke-width": 1.5, "vector-effect": "non-scaling-stroke",
      }));
    }
  });
  // Draggable nodes, on top.
  glyph().pieces.forEach((p, i) => {
    const selected = i === selectedPiece;
    for (const h of pieceHandles(p)) {
      const size = cu * (selected ? 0.26 : 0.2);
      layer.appendChild(el("rect", {
        x: h.x * cu - size / 2, y: -h.y * cu - size / 2, width: size, height: size,
        fill: selected ? PIECE_COLOR : "#fff", stroke: PIECE_COLOR, "stroke-width": 1.5, "vector-effect": "non-scaling-stroke",
      }));
    }
  });
  // Preview while dragging.
  if (action?.type === "piece" && action.moved && action.x0 !== action.x1 && action.y0 !== action.y1) {
    const p = normalizePiece({
      x0: action.x0, y0: action.y0, x1: action.x1, y1: action.y1,
      corner: (action.y0 <= action.y1 ? "b" : "t") + (action.x0 <= action.x1 ? "l" : "r"),
      shape: $("pieceShape").value, mode: pieceMode,
    });
    const color = pieceMode === "cut" ? "#d6249f" : PIECE_COLOR;
    layer.appendChild(el("path", {
      d: contoursToPath([pieceContour(p)], cu), fill: color, "fill-opacity": 0.3,
      stroke: color, "stroke-width": 2, "vector-effect": "non-scaling-stroke",
    }));
  }
}

function syncPieceList() {
  const pieces = glyph().pieces;
  if (selectedPiece !== null && selectedPiece >= pieces.length) selectedPiece = null;
  $("pieceListBox").hidden = pieces.length === 0;
  const list = $("pieceList");
  list.replaceChildren();
  pieces.forEach((p, i) => {
    const n = normalizePiece(p);
    const row = document.createElement("div");
    row.className = "piece-row" + (i === selectedPiece ? " active" : "");
    const label = document.createElement("button");
    label.type = "button";
    label.className = "piece-label";
    label.textContent = `${PIECE_SHAPES[n.shape]} · ${n.mode === "cut" ? "recorta" : "agrega"} · ${n.x1 - n.x0}×${n.y1 - n.y0}`;
    label.addEventListener("click", () => {
      setTool("piece");
      selectedPiece = i;
      render(null);
      syncPieceList();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "comp-remove";
    remove.textContent = "×";
    remove.title = "Quitar pieza";
    remove.addEventListener("click", () => removePiece(i));
    row.append(label, remove);
    list.appendChild(row);
  });
}

// --- Corner tool (square grid) ---
// Corners of the glyph's final outline (after its pieces), keyed by position,
// each with the directions of its two edges and the radius it really gets.
function outlineCorners() {
  const g = glyph();
  const shape = glyphShape(font, g);
  const cells = resolvedCells(font, g);
  const stroke = font.style === "outline" ? font.stroke / font.cell : 0;
  const out = new Map();
  if (shape.pieces.length) {
    for (const c of pieceGlyphCorners(cells, { rounding: shape.rounding, corners: shape.corners, pieces: shape.pieces })) {
      out.set(c.key, { x: c.x, y: c.y, back: [-c.din[0], -c.din[1]], fwd: c.dout, radius: c.radius });
    }
    return out;
  }
  const real = effectiveRadii(cells, { rounding: shape.rounding, corners: shape.corners, stroke });
  for (const v of squareCorners(cells)) {
    const k = key(v.x, v.y);
    out.set(k, { x: v.x, y: v.y, back: DIRS4[(v.din + 2) % 4], fwd: DIRS4[v.dout], radius: real[k] ?? 0 });
  }
  return out;
}

const DIRS4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// Radius chosen in the toolbar ("max" at the end of the slider).
const sliderRadius = () => (+$("cornerRadius").value >= MAX_RADIUS ? "max" : +$("cornerRadius").value);

// The corner under the pointer and its mirror images.
function cornerTargets(evt) {
  const { x, y } = toCells(evt);
  let best = null, bestDist = 0.4;
  for (const [k, c] of outlineCorners()) {
    const dist = Math.hypot(x - c.x, y - c.y);
    if (dist < bestDist) { best = { k, ...c }; bestDist = dist; }
  }
  if (!best) return null;
  const g = glyph();
  const [lo, hi] = axisRows(font.view.mirrorAxis, font.metrics, font.active);
  let points = [[best.x, best.y]];
  if (font.view.mirrorH) points = [...points, ...points.map(([px, py]) => [g.cols - px, py])];
  if (font.view.mirrorV) points = [...points, ...points.map(([px, py]) => [px, lo + hi - py])];
  const targets = [...new Set(points.map(([px, py]) => cornerKey(px, py)))];
  return { k: best.k, px: best.x, py: best.y, targets };
}

function setCorners(targets, value) {
  const g = glyph();
  for (const t of targets) {
    if (value === null) delete g.corners[t];
    else g.corners[t] = value;
  }
  render();
}

// Press on a corner: a click applies the toolbar radius (or, if the corner
// already has it, returns it to the global rounding; Shift leaves it sharp);
// dragging inward sets the radius to the distance dragged.
function startCorner(evt) {
  const hit = cornerTargets(evt);
  if (!hit) {
    toast("Haz clic en un punto de esquina de la letra.");
    return;
  }
  checkpoint();
  action = { type: "corner", ...hit, shift: evt.shiftKey, dragged: false, before: glyph().corners[hit.k] };
}

function dragCorner(evt) {
  const { x, y } = toCells(evt);
  const reach = Math.max(Math.abs(x - action.px), Math.abs(y - action.py));
  if (!action.dragged && reach < 0.3) return;
  action.dragged = true;
  const r = Math.min(MAX_RADIUS, Math.max(0.5, Math.round(reach * 2) / 2));
  if (glyph().corners[action.k] !== r) setCorners(action.targets, r);
}

function endCorner(done) {
  if (done.dragged) return;
  const wanted = done.shift ? 0 : sliderRadius();
  setCorners(done.targets, done.before === wanted ? null : wanted);
}

const radiusText = (r) => (Number.isInteger(r * 2) ? String(r).replace(".5", "½").replace(/^0½/, "½") : r.toFixed(1));

function drawCornerMarkers(layer) {
  const cu = font.cell;
  const own = glyph().corners;
  for (const [k, c] of outlineCorners()) {
    // The radius it really got, next to every corner with its own radius.
    if (own[k] !== undefined && own[k] !== 0) {
      const lx = c.x + 0.45 * (c.back[0] + c.fwd[0]), ly = c.y + 0.45 * (c.back[1] + c.fwd[1]);
      const t = el("text", {
        x: lx * cu, y: -ly * cu, "font-size": cu * 0.36, "text-anchor": "middle", "dominant-baseline": "central",
        fill: "#d6249f", stroke: "#fff", "stroke-width": 3, "paint-order": "stroke", "font-weight": 600,
        "font-family": "ui-sans-serif, system-ui, sans-serif",
      });
      t.textContent = radiusText(c.radius);
      layer.appendChild(t);
    }
    const set = own[k];
    const sharp = set === 0;
    layer.appendChild(el(sharp ? "rect" : "circle", sharp
      ? { x: c.x * cu - cu * 0.11, y: -c.y * cu - cu * 0.11, width: cu * 0.22, height: cu * 0.22, fill: "#1d1d1b", stroke: "#fff", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke" }
      : { cx: c.x * cu, cy: -c.y * cu, r: cu * 0.13, fill: set === undefined ? "#fff" : "#d6249f", stroke: "#d6249f", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke" }));
  }
}

// Double-click with the select tool picks the whole stroke.
board.addEventListener("dblclick", (evt) => {
  if (tool === "nodes") { nodeDoubleClick(evt); return; }
  if (tool !== "select") return;
  const k = cellAt(evt);
  if (!k) return;
  connectedCells(glyph().cells, k).forEach((c) => selection.add(c));
  render(null);
});

// --- Zoom and pan ---
const ZOOM_MIN = 0.5, ZOOM_MAX = 12;

function zoomAt(factor, point) {
  const box = zoomBox ?? fitBox;
  const level = fitBox.w / box.w;
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level * factor));
  const k = next / level;
  if (k === 1) return;
  const p = point ?? { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  zoomBox = { x: p.x - (p.x - box.x) / k, y: p.y - (p.y - box.y) / k, w: box.w / k, h: box.h / k };
  render(null);
}

function zoomFit() {
  zoomBox = null;
  render(null);
}

board.addEventListener("wheel", (evt) => {
  if (evt.ctrlKey || evt.metaKey) {
    evt.preventDefault();
    const { x, y } = toUnits(evt);
    // Clamped so a mouse-wheel notch and a trackpad pinch feel similar.
    const delta = Math.max(-50, Math.min(50, evt.deltaY));
    zoomAt(Math.exp(-delta * 0.006), { x, y: -y });
  } else if (zoomBox) {
    evt.preventDefault();
    const scale = board.getScreenCTM().a;
    zoomBox = { ...zoomBox, x: zoomBox.x + evt.deltaX / scale, y: zoomBox.y + evt.deltaY / scale };
    render(null);
  }
}, { passive: false });

$("zoomIn").addEventListener("click", () => zoomAt(1.25));
$("zoomOut").addEventListener("click", () => zoomAt(0.8));
$("zoomFit").addEventListener("click", zoomFit);

// --- Toolbar ---
$("toolDraw").addEventListener("click", () => setTool("draw"));
$("toolSelect").addEventListener("click", () => setTool("select"));
$("toolCorner").addEventListener("click", () => setTool("corner"));
$("toolPiece").addEventListener("click", () => setTool("piece"));
$("toolNodes").addEventListener("click", () => setTool("nodes"));
$("pieceAdd").addEventListener("click", () => { pieceMode = "add"; syncToolbar(); });
$("pieceCut").addEventListener("click", () => { pieceMode = "cut"; syncToolbar(); });
$("cornerRadius").addEventListener("input", (e) => {
  $("cornerRadiusOut").textContent = +e.target.value >= MAX_RADIUS ? "máx" : String(+e.target.value).replace(".5", "½").replace(/^0½/, "½");
});

for (const id of ["mirrorH", "mirrorV"]) {
  $(id).addEventListener("click", () => {
    font.view[id] = !font.view[id];
    syncToolbar();
    render(null);
  });
}
$("mirrorAxis").addEventListener("change", (e) => {
  font.view.mirrorAxis = e.target.value;
  render(null);
});
$("background").addEventListener("change", (e) => {
  font.view.background = e.target.value;
  render(null);
});

function buildToolbar() {
  for (const [value, name] of Object.entries(GRIDS)) $("newFontGrid").appendChild(new Option(name, value));
  for (const [value, name] of Object.entries(GRIDS)) $("gridType").appendChild(new Option(name, value));
  for (const [value, name] of Object.entries(AXES)) {
    $("mirrorAxis").appendChild(new Option(name, value));
  }
  $("background").appendChild(new Option("Ninguno", ""));
  for (const char of CHARSET) {
    $("background").appendChild(new Option(charLabel(char), char));
  }
}

function syncToolbar() {
  const squares = glyphGrid(font, glyph()) === "squares";
  const nodesOnly = !!glyph().outline;
  for (const id of ["toolDraw", "toolSelect"]) $(id).disabled = nodesOnly;
  if (nodesOnly && tool !== "nodes") setTool("nodes");
  $("toolCorner").disabled = !squares || nodesOnly;
  $("toolPiece").disabled = !squares || nodesOnly;
  if (!squares && (tool === "corner" || tool === "piece")) setTool("draw");
  $("pieceAdd").classList.toggle("active", pieceMode === "add");
  $("pieceCut").classList.toggle("active", pieceMode === "cut");
  $("mirrorH").classList.toggle("active", font.view.mirrorH);
  $("mirrorV").classList.toggle("active", font.view.mirrorV);
  $("mirrorH").setAttribute("aria-pressed", font.view.mirrorH);
  $("mirrorV").setAttribute("aria-pressed", font.view.mirrorV);
  $("mirrorAxis").value = font.view.mirrorAxis;
  $("mirrorAxis").disabled = !font.view.mirrorV;
  $("background").value = font.view.background;
}

function charLabel(char) {
  const shown = char === " " ? "␣" : char;
  return glyphName(char) === char ? shown : `${shown}  ${glyphName(char)}`;
}

// --- Selection editing ---
function deleteSelection() {
  if (!selection.size) return;
  checkpoint();
  glyph().cells = glyph().cells.filter((k) => !selection.has(k));
  selection.clear();
  render();
}

function nudge(dc, dr) {
  if (!selection.size) return;
  checkpoint("nudge");
  const g = glyph();
  const moved = translate([...selection], dc, dr);
  g.cells = [...new Set([...g.cells.filter((k) => !selection.has(k)), ...moved])];
  selection.clear();
  moved.forEach((k) => selection.add(k));
  render();
}

function copySelection() {
  clipboard = selection.size ? [...selection] : [...glyph().cells];
  toast(`${clipboard.length} celda(s) copiadas`);
}

function paste() {
  if (!clipboard?.length) return;
  checkpoint();
  const g = glyph();
  g.cells = [...new Set([...g.cells, ...clipboard])];
  setTool("select");
  selection.clear();
  clipboard.forEach((k) => selection.add(k));
  render();
}

window.addEventListener("keydown", (e) => {
  if (e.target.matches?.("input, select, textarea") || e.target.closest?.(".testbar")) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod) {
    if (k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (k === "c") { e.preventDefault(); copySelection(); }
    else if (k === "x") { e.preventDefault(); copySelection(); deleteSelection(); }
    else if (k === "v") { e.preventDefault(); paste(); }
    else if (k === "a" && tool === "nodes") {
      e.preventDefault();
      editableOutline().forEach((c, ci) => c.nodes.forEach((_, ni) => nodeSel.add(`${ci}:${ni}`)));
      render(null);
    }
    else if (k === "a") {
      e.preventDefault();
      setTool("select");
      glyph().cells.forEach((c) => selection.add(c));
      render(null);
    }
    return;
  }
  const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, 1], arrowdown: [0, -1] };
  if (tool === "nodes" && arrows[k] && nodeSel.size) {
    // Nodes move a quarter of a cell (Shift: a whole cell).
    e.preventDefault();
    const step = e.shiftKey ? 1 : 0.25;
    nudgeNodes(arrows[k][0] * step, arrows[k][1] * step);
  }
  else if (tool === "nodes" && (k === "delete" || k === "backspace")) { e.preventDefault(); deleteSelectedNodes(); }
  else if (tool === "nodes" && k === "escape") { nodeSel.clear(); render(null); }
  else if (arrows[k] && selection.size) { e.preventDefault(); nudge(...arrows[k]); }
  else if ((k === "delete" || k === "backspace") && tool === "piece" && selectedPiece !== null) { e.preventDefault(); removePiece(selectedPiece); }
  else if (k === "delete" || k === "backspace") { if (selection.size) { e.preventDefault(); deleteSelection(); } }
  else if (k === "escape") { selection.clear(); render(null); }
  else if (k === "b") setTool("draw");
  else if (k === "v") setTool("select");
  else if (k === "e") setTool("corner");
  else if (k === "p") setTool("piece");
  else if (k === "a") setTool("nodes");
  else if (k === "+" || k === "=") zoomAt(1.25);
  else if (k === "-") zoomAt(0.8);
  else if (k === "0") zoomFit();
  else if (k === " ") {
    // Holding space: only the letter is shown (and dragging pans the view).
    e.preventDefault();
    if (spaceDown) return; // key repeat
    spaceDown = true;
    board.classList.add("pan-ready");
    render(null);
  }
});

function endPreview() {
  if (!spaceDown) return;
  spaceDown = false;
  board.classList.remove("pan-ready");
  render(null);
}

window.addEventListener("keyup", (e) => { if (e.key === " ") endPreview(); });
// Releasing space while the window lost focus would leave it stuck.
window.addEventListener("blur", endPreview);

// --- Glyph panel ---
function syncGlyphPanel() {
  const g = glyph();
  const char = font.active;
  $("glyphChar").textContent = char === " " ? "␣" : char;
  $("glyphName").textContent = glyphName(char);
  $("glyphCode").textContent = codepoint(char);
  const gridSelect = $("glyphGrid");
  gridSelect.replaceChildren(new Option(`Como la fuente (${GRIDS[font.grid]})`, ""));
  for (const [value, name] of Object.entries(GRIDS)) gridSelect.appendChild(new Option(name, value));
  gridSelect.value = g.grid ?? "";
  $("cols").value = g.cols;
  $("colsOut").textContent = g.cols;
  $("lsb").value = g.lsb;
  $("rsb").value = g.rsb;
  $("advanceInfo").textContent =
    `Ancho de avance: ${advanceWidth(font, g)} u = ${g.lsb} + ${g.cols} × ${font.cell} + ${g.rsb}`;
  renderComponents();
  syncPieceList();
  const edited = !!g.outline;
  $("editNodes").hidden = edited;
  $("backToGrid").hidden = !edited;
  $("nodeInfo").textContent = edited
    ? "Esta letra se edita con nodos, como en Illustrator (herramienta Nodos, A)."
    : "Convierte la letra en un contorno de nodos para moverlos a mano. También pasa al mover un nodo con la herramienta Nodos.";
}

$("editNodes").addEventListener("click", () => {
  checkpoint();
  ensureOutline();
  setTool("nodes");
  syncControls();
  render();
});

$("backToGrid").addEventListener("click", () => {
  checkpoint();
  glyph().outline = null;
  nodeSel.clear();
  setTool("draw");
  syncControls();
  render();
  toast("La letra volvió a la grilla (los cambios de nodos se pueden recuperar con Cmd/Ctrl + Z).");
});

function renderComponents() {
  const g = glyph();
  const list = $("componentList");
  list.replaceChildren();
  if (!g.components.length) {
    const p = document.createElement("p");
    p.className = "info";
    p.textContent = "Sin componentes. Agrega otro glifo para reutilizar su dibujo: si lo editas, este glifo se actualiza.";
    list.appendChild(p);
  }
  g.components.forEach((comp, i) => {
    const row = document.createElement("div");
    row.className = "component";
    const name = document.createElement("button");
    name.type = "button";
    name.className = "comp-name";
    name.textContent = comp.glyph === " " ? "␣" : comp.glyph;
    name.title = `Editar «${glyphName(comp.glyph)}»`;
    name.addEventListener("click", () => selectGlyph(comp.glyph));
    row.appendChild(name);
    for (const axis of ["dx", "dy"]) {
      const label = document.createElement("label");
      label.textContent = axis === "dx" ? "x" : "y";
      const input = document.createElement("input");
      input.type = "number";
      input.step = 1;
      input.value = comp[axis];
      input.title = axis === "dx" ? "Desplazamiento horizontal (columnas)" : "Desplazamiento vertical (filas)";
      input.addEventListener("change", () => {
        checkpoint();
        comp[axis] = Math.round(+input.value) || 0;
        render();
      });
      label.appendChild(input);
      row.appendChild(label);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "comp-remove";
    remove.textContent = "×";
    remove.title = "Quitar componente";
    remove.addEventListener("click", () => {
      checkpoint();
      g.components.splice(i, 1);
      syncGlyphPanel();
      render();
    });
    row.appendChild(remove);
    list.appendChild(row);
  });

  const select = $("componentSource");
  select.replaceChildren();
  for (const char of CHARSET) {
    if (!canUseComponent(font, font.active, char)) continue;
    const opt = document.createElement("option");
    opt.value = char;
    opt.textContent = charLabel(char);
    select.appendChild(opt);
  }
  $("decompose").disabled = g.components.length === 0;

  const copy = $("copySource");
  copy.replaceChildren();
  for (const char of CHARSET) {
    if (char === font.active) continue;
    const empty = isEmptyGlyph(font.glyphs[char]);
    copy.appendChild(new Option(charLabel(char) + (empty ? " (vacío)" : ""), char));
  }
}

// Copies another glyph's drawing as a starting point (e.g. "n" → "h").
$("copyFrom").addEventListener("click", () => {
  const source = $("copySource").value;
  const src = font.glyphs[source];
  if (!src) return;
  checkpoint();
  const g = glyph();
  Object.assign(g, {
    cells: [...src.cells], cols: src.cols, lsb: src.lsb, rsb: src.rsb, curve: src.curve,
    grid: src.grid, rounding: src.rounding, corners: { ...src.corners },
    pieces: src.pieces.map((p) => ({ ...p })),
    metrics: { ...src.metrics },
    components: src.components.filter((c) => canUseComponent(font, font.active, c.glyph)).map((c) => ({ ...c })),
  });
  selection.clear();
  syncControls();
  render();
  toast(`Dibujo copiado desde «${source}» · Cmd/Ctrl + Z para deshacer`);
});

$("addComponent").addEventListener("click", () => {
  const source = $("componentSource").value;
  if (!canUseComponent(font, font.active, source)) return;
  checkpoint();
  glyph().components.push({ glyph: source, dx: 0, dy: 0 });
  syncGlyphPanel();
  render();
});

$("decompose").addEventListener("click", () => {
  checkpoint();
  const g = glyph();
  g.cells = resolvedCells(font, g);
  g.components = [];
  syncGlyphPanel();
  render();
});

// --- Other panels ---
function buildMetricInputs() {
  const box = $("metricInputs");
  for (const def of METRICS) {
    const label = document.createElement("label");
    label.className = "row metric";
    label.innerHTML = `<span><i class="swatch" style="background:${def.color}"></i>${def.name}</span>`;
    const input = document.createElement("input");
    input.type = "number";
    input.id = `m-${def.key}`;
    if (def.key === "baseline") {
      input.value = 0;
      input.disabled = true;
    } else {
      input.addEventListener("change", () => {
        checkpoint();
        font.metrics = setMetric(font.metrics, def.key, +input.value / font.cell);
        syncMetricInputs();
        render("font");
      });
    }
    label.appendChild(input);
    box.appendChild(label);
  }
}

function syncMetricInputs() {
  for (const def of METRICS) {
    if (def.key === "baseline") continue;
    const input = $(`m-${def.key}`);
    input.step = font.cell;
    input.value = font.metrics[def.key] * font.cell;
  }
}

function syncControls() {
  const g = glyph();
  syncGlyphPanel();
  $("cell").value = font.cell;
  $("upm").value = font.upm;
  $("guides").checked = font.view.guides;
  $("gridOpacity").value = Math.round(font.view.gridOpacity * 100);
  $("gridOpacityOut").textContent = Math.round(font.view.gridOpacity * 100) + "%";
  $("gridOpacity").disabled = !font.view.guides;
  // The shape controls edit the setting of the active glyph's grid:
  // circle size for circles, corner rounding for squares.
  const squares = glyphGrid(font, g) === "squares";
  const k = shapeKey(font, g);
  const word = squares ? "Redondeo" : "Curvatura";
  const pct = (v) => Math.round(v * 100) + "%";
  for (const id of ["curve", "glyphCurve"]) $(id).min = squares ? 0 : 20;
  $("curveLabel").textContent = `${word} global`;
  $("curve").value = Math.round(font[k] * 100);
  // Square grid: the global rounding waits for "Redondear todas las esquinas".
  $("roundAll").checked = font.roundAll;
  $("curve").disabled = squares && !font.roundAll;
  $("roundAllInfo").textContent = font.roundAll
    ? "Todas las esquinas se redondean con el redondeo global."
    : "Las esquinas quedan en punta. Actívalo cuando quieras redondearlas todas (por ejemplo, al final); las esquinas de la herramienta Esquinas se redondean igual.";
  $("curveOut").textContent = pct(font[k]);
  const own = g[k] != null;
  $("glyphCurveGlobal").hidden = own;
  $("glyphCurveOwn").hidden = !own;
  $("glyphCurveText").textContent = `Este glifo usa ${squares ? "el redondeo global" : "la curvatura global"}.`;
  $("ownCurve").textContent = `${word} propi${squares ? "o" : "a"}`;
  $("glyphCurveLabel").textContent = `${word} propi${squares ? "o" : "a"}`;
  $("useGlobal").textContent = `Usar ${squares ? "redondeo global" : "curvatura global"}`;
  $("glyphCurve").value = Math.round((g[k] ?? font[k]) * 100);
  $("glyphCurveOut").textContent = pct(g[k] ?? font[k]);
  $("circleOptions").hidden = squares;
  $("squareOptions").hidden = !squares;
  $("style").value = font.style;
  $("stroke").value = font.stroke;
  $("stroke").max = Math.floor(font.cell * 0.45);
  $("stroke").disabled = font.style !== "outline";
  $("gridType").value = font.grid;
  $("join").checked = font.join.enabled;
  $("joinWidth").value = font.join.width;
  $("joinWidth").disabled = !font.join.enabled;
  $("ink").value = font.view.ink;
  $("paper").value = font.view.paper;
  $("showMetrics").checked = font.view.metrics;
  $("overshoot").value = font.overshoot;
  syncMetricInputs();
  syncToolbar();
  syncMeta();
}

function updateInfo() {
  const m = font.metrics;
  const rows = m.ascender - m.descender;
  $("gridInfo").textContent =
    `${rows} filas de ${font.cell} u = ${rows * font.cell} u (ascendente − descendente)` +
    (rows * font.cell === font.upm ? "" : ` · el UPM es ${font.upm}`);
  const plan = planFit(font);
  $("fit").disabled = plan.pending.length === 0;
  $("fitInfo").textContent = plan.pending.length === 0
    ? "Todos los glifos están dibujados con las métricas actuales."
    : `${plan.pending.length} glifo(s) dibujados con métricas anteriores.`;
  $("undo").disabled = undoStack.length === 0;
  $("redo").disabled = redoStack.length === 0;
}

// Small helper for controls that edit the font and re-render.
// scope "glyph" refreshes the active glyph's thumbnails, "font" all of them.
function bind(id, event, apply, scope = "glyph", tag = id) {
  $(id).addEventListener(event, (e) => {
    checkpoint(tag);
    apply(e.target);
    syncControls();
    render(scope);
  });
}

bind("cols", "input", (t) => { glyph().cols = +t.value; });
bind("lsb", "change", (t) => { glyph().lsb = clampNum(Math.round(+t.value), -1000, 2000, glyph().lsb); });
bind("rsb", "change", (t) => { glyph().rsb = clampNum(Math.round(+t.value), -1000, 2000, glyph().rsb); });
bind("cell", "change", (t) => { font.cell = clampNum(+t.value, 5, 250, font.cell); }, "font");
bind("upm", "change", (t) => { font.upm = clampNum(Math.round(+t.value), 16, 16384, font.upm); }, null);
bind("guides", "change", (t) => { font.view.guides = t.checked; }, null);
bind("gridOpacity", "input", (t) => { font.view.gridOpacity = t.value / 100; }, null);
bind("curve", "input", (t) => { font[shapeKey(font, glyph())] = t.value / 100; }, "font");
bind("glyphCurve", "input", (t) => { glyph()[shapeKey(font, glyph())] = t.value / 100; });
bind("ownCurve", "click", () => { const k = shapeKey(font, glyph()); glyph()[k] = font[k]; });
bind("useGlobal", "click", () => { glyph()[shapeKey(font, glyph())] = null; });
bind("gridType", "change", (t) => { font.grid = t.value; }, "font");
bind("glyphGrid", "change", (t) => { glyph().grid = t.value || null; });
bind("style", "change", (t) => { font.style = t.value; }, "font");
bind("roundAll", "change", (t) => { font.roundAll = t.checked; }, "font");
bind("stroke", "change", (t) => { font.stroke = clampNum(Math.round(+t.value), 1, Math.floor(font.cell * 0.45), font.stroke); }, "font");
bind("join", "change", (t) => { font.join.enabled = t.checked; }, "font");
bind("joinWidth", "change", (t) => { font.join.width = clampNum(+t.value, 1, 250, font.join.width); }, "font");
bind("ink", "input", (t) => { font.view.ink = t.value; }, "font");
bind("paper", "input", (t) => { font.view.paper = t.value; }, "font");
bind("showMetrics", "change", (t) => { font.view.metrics = t.checked; }, null);
bind("overshoot", "change", (t) => { font.overshoot = clampNum(+t.value, 0, 200, font.overshoot); }, null);

function clampNum(v, lo, hi, fallback) {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

// --- Actions ---
$("undo").addEventListener("click", undo);
$("redo").addEventListener("click", redo);

$("clear").addEventListener("click", () => {
  checkpoint();
  selection.clear();
  if (glyph().outline) { glyph().outline = null; nodeSel.clear(); syncControls(); }
  glyph().cells = [];
  glyph().metrics = { ...font.metrics };
  render();
});

$("invert").addEventListener("click", () => {
  checkpoint();
  const g = glyph();
  const has = new Set(g.cells);
  const next = [];
  for (let c = 0; c < bounds.cols; c++) {
    for (let r = bounds.lo; r < bounds.hi; r++) {
      if (!has.has(key(c, r))) next.push(key(c, r));
    }
  }
  g.cells = next;
  selection.clear();
  render();
});

$("save").addEventListener("click", () => {
  checkpoint();
  const g = glyph();
  font.drafts.push(createGlyph({
    ...g, cells: resolvedCells(font, g), corners: resolvedCorners(font, g), pieces: resolvedPieces(font, g), components: [],
  }));
  renderGallery();
  persist();
});

$("fit").addEventListener("click", () => {
  const plan = planFit(font);
  if (plan.affected === 0) {
    checkpoint();
    applyFit(font, plan);
    render(null);
    return;
  }
  const total = plan.pending.length;
  $("fitMessage").textContent =
    `Se modificarán ${plan.affected} de ${total} glifo(s) dibujados con métricas anteriores: ` +
    `se insertarán o quitarán filas enteras en las zonas que cambiaron. Puedes deshacerlo.`;
  const dialog = $("fitDialog");
  dialog.onclose = () => {
    if (dialog.returnValue !== "apply") return;
    checkpoint();
    applyFit(font, planFit(font));
    render("font");
    renderGallery();
  };
  dialog.showModal();
});

// --- Text test bar ---
const PRESETS = [
  "hamburgefonstiv",
  "HOHOHOH nonono",
  "Hamburgefonstiv",
  "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ",
  "abcdefghijklmnñopqrstuvwxyz",
  "0123456789 .,;:!?-'\"()",
  "AV To Ta Ye LT Wa",
  "El veloz murciélago hindú comía feliz cardillo y kiwi.",
  "niño año ñandú canción",
];
const KERN_STEP = 10;

let kernPair = null; // { left, right, line, index } — line/index when it is in the text
let testLayout = null;
let testFrame = 0;

function scheduleTest() {
  if (testFrame) return;
  testFrame = requestAnimationFrame(() => {
    testFrame = 0;
    renderTest();
  });
}

function renderTest() {
  const t = font.view.test;
  const ink = t.inverted ? font.view.paper : font.view.ink;
  const paper = t.inverted ? font.view.ink : font.view.paper;
  // Keep the pair's position only while the text still has it there.
  if (kernPair?.line != null) {
    const items = layoutText(font, t.text).items;
    const i = items.findIndex((it) => it.line === kernPair.line && it.index === kernPair.index);
    if (i < 0 || items[i].char !== kernPair.left || items[i + 1]?.char !== kernPair.right || items[i + 1]?.line !== kernPair.line) {
      kernPair = { left: kernPair.left, right: kernPair.right };
    }
  }
  testLayout = drawText($("testSvg"), font, t.text, {
    size: t.size, ink, paper, pair: kernPair?.line != null ? kernPair : null,
  });
  $("testView").style.background = paper;
  syncTestControls();
}

function syncTestControls() {
  const t = font.view.test;
  if ($("testText").value !== t.text) $("testText").value = t.text;
  document.querySelectorAll(".segmented [data-size]").forEach((b) => b.classList.toggle("active", +b.dataset.size === t.size));
  $("testInvert").classList.toggle("active", t.inverted);
  $("testInvert").setAttribute("aria-pressed", t.inverted);

  const has = !!kernPair;
  $("kernPair").textContent = has ? `${kernPair.left}${kernPair.right}` : "—";
  $("kernValue").value = has ? kerningValue(font, kernPair.left, kernPair.right) : "";
  for (const id of ["kernMinus", "kernValue", "kernPlus", "kernClear"]) $(id).disabled = !has;

  const list = $("kernList");
  list.replaceChildren();
  const pairs = Object.entries(font.kerning);
  if (!pairs.length) {
    list.textContent = "Clic entre dos letras del texto para ajustar su kerning (también con ← →).";
    return;
  }
  for (const [pair, value] of pairs) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "kern-chip";
    chip.classList.toggle("active", has && pair === kernPair.left + kernPair.right);
    chip.textContent = `${pair} ${value > 0 ? "+" : ""}${value}`;
    chip.addEventListener("click", () => {
      const [left, right] = [...pair];
      const at = testLayout.items.find((it, i, all) => it.char === left && all[i + 1]?.char === right && all[i + 1].line === it.line);
      kernPair = at ? { left, right, line: at.line, index: at.index } : { left, right };
      renderTest();
    });
    list.appendChild(chip);
  }
}

function setPairKerning(value) {
  if (!kernPair) return;
  checkpoint("kern");
  setKerning(font, kernPair.left, kernPair.right, value);
  renderTest();
  updateInfo();
  persist();
}

const adjustKerning = (delta) => kernPair && setPairKerning(kerningValue(font, kernPair.left, kernPair.right) + delta);

// Clicking the right half of a letter picks the pair it forms with the next
// one; the left half picks the pair with the previous one.
function pairFromEvent(evt) {
  const hit = evt.target.closest?.(".t-hit");
  if (!hit) return null;
  const line = +hit.dataset.line, index = +hit.dataset.index;
  const box = hit.getBoundingClientRect();
  const leftIndex = evt.clientX > box.left + box.width / 2 ? index : index - 1;
  const items = testLayout.items;
  const a = items.find((it) => it.line === line && it.index === leftIndex);
  const b = items.find((it) => it.line === line && it.index === leftIndex + 1);
  return a && b ? { left: a.char, right: b.char, line, index: leftIndex } : null;
}

$("testView").addEventListener("click", (evt) => {
  kernPair = pairFromEvent(evt);
  $("testView").focus({ preventScroll: true });
  renderTest();
});

$("testView").addEventListener("dblclick", (evt) => {
  const hit = evt.target.closest?.(".t-hit");
  if (!hit) return;
  const item = testLayout.items.find((it) => it.line === +hit.dataset.line && it.index === +hit.dataset.index);
  if (item && font.glyphs[item.char]) selectGlyph(item.char);
});

$("testView").addEventListener("keydown", (evt) => {
  const step = evt.shiftKey ? KERN_STEP * 5 : KERN_STEP;
  if (evt.key === "ArrowLeft" && kernPair) { evt.preventDefault(); adjustKerning(-step); }
  else if (evt.key === "ArrowRight" && kernPair) { evt.preventDefault(); adjustKerning(step); }
  else if (evt.key === "Escape") { kernPair = null; renderTest(); }
});

$("testText").addEventListener("input", (e) => {
  font.view.test.text = e.target.value;
  renderTest();
  persist();
});

$("testPreset").addEventListener("change", (e) => {
  if (!e.target.value) return;
  font.view.test.text = e.target.value;
  e.target.value = "";
  kernPair = null;
  renderTest();
  persist();
});

document.querySelectorAll(".segmented [data-size]").forEach((b) => {
  b.addEventListener("click", () => {
    font.view.test.size = +b.dataset.size;
    renderTest();
    persist();
  });
});

$("testInvert").addEventListener("click", () => {
  font.view.test.inverted = !font.view.test.inverted;
  renderTest();
  persist();
});

$("kernMinus").addEventListener("click", (e) => adjustKerning(e.shiftKey ? -KERN_STEP * 5 : -KERN_STEP));
$("kernPlus").addEventListener("click", (e) => adjustKerning(e.shiftKey ? KERN_STEP * 5 : KERN_STEP));
$("kernValue").addEventListener("change", (e) => setPairKerning(+e.target.value || 0));
$("kernClear").addEventListener("click", () => setPairKerning(0));

for (const text of PRESETS) $("testPreset").appendChild(new Option(text, text));

// --- Font panel: metadata, project files and .otf ---
const META_FIELDS = { metaFamily: "family", metaStyle: "style", metaDesigner: "designer", metaVersion: "version" };

for (const [id, field] of Object.entries(META_FIELDS)) {
  $(id).addEventListener("change", (e) => {
    checkpoint();
    font.meta[field] = e.target.value.trim();
    updateInfo();
    persist();
  });
}

function syncMeta() {
  for (const [id, field] of Object.entries(META_FIELDS)) $(id).value = font.meta[field];
}

// File-name-safe "Familia-Estilo".
function baseName() {
  const clean = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "");
  return [clean(font.meta.family) || "LetrasExperimentales", clean(font.meta.style) || "Regular"].join("-");
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  download(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("saveProject").addEventListener("click", () => {
  downloadBlob(new Blob([JSON.stringify(font, null, 2)], { type: "application/json" }), `${baseName()}.json`);
  toast("Proyecto guardado como archivo .json");
});

$("openProject").addEventListener("click", () => $("projectFile").click());

$("projectFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast("No se pudo leer el archivo: no es un JSON válido.");
    return;
  }
  const isProject = data?.format === "experimental-letters" || Array.isArray(data?.filled);
  if (!isProject) {
    toast("Ese archivo no es un proyecto de Letras experimentales.");
    return;
  }
  switchTo(newId(), normalizeFont(data));
  toast(`«${fontName(font)}» se abrió como una tipografía nueva de tu biblioteca`);
});

$("exportOtf").addEventListener("click", async () => {
  const button = $("exportOtf");
  button.disabled = true;
  button.textContent = "Generando…";
  try {
    const { buildOtf } = await import("./otf.js");
    const buffer = await buildOtf(font, { mode: $("otfMode").value });
    downloadBlob(new Blob([buffer], { type: "font/otf" }), `${baseName()}.otf`);
    toast("Fuente exportada. Instálala con doble clic para usarla en Illustrator o InDesign.");
  } catch (err) {
    console.error(err);
    toast(`No se pudo exportar la fuente: ${err.message}`);
  } finally {
    button.disabled = false;
    button.textContent = "Exportar fuente (.otf)";
  }
});

// --- Library: Nueva, Guardar, Duplicar, Eliminar and switching fonts ---
let librarySignature = "";

function syncLibrary() {
  const select = $("fontSelect");
  const signature = library.active + "|" + library.fonts.map((f) => f.id + f.name).join("|");
  if (signature !== librarySignature) {
    librarySignature = signature;
    select.replaceChildren(...[...library.fonts]
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map((f) => new Option(f.name, f.id)));
    select.value = library.active;
  }
  const time = lastSaved?.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  $("saveStatus").textContent = saveFailed
    ? "No se pudo guardar en el navegador. Descarga el .json."
    : `${library.fonts.length} tipografía${library.fonts.length === 1 ? "" : "s"} en este navegador` +
      (time ? ` · guardada a las ${time}` : "");
}

// Saves the open font, then opens `data` under `id` with a fresh history.
function switchTo(id, data) {
  persist();
  library.active = id;
  font = data;
  undoStack.length = 0;
  redoStack.length = 0;
  lastTag = null;
  kernPair = null;
  zoomBox = null;
  refreshAll();
}

function confirmAction({ title, message, ok }) {
  $("confirmTitle").textContent = title;
  $("confirmMessage").textContent = message;
  $("confirmOk").textContent = ok;
  const dialog = $("confirmDialog");
  return new Promise((resolve) => {
    dialog.onclose = () => resolve(dialog.returnValue === "ok");
    dialog.returnValue = "";
    dialog.showModal();
  });
}

$("fontSelect").addEventListener("change", (e) => {
  const id = e.target.value;
  const data = loadFont(storage, id);
  if (!data) {
    toast("No se pudo abrir esa tipografía.");
    e.target.value = library.active;
    return;
  }
  switchTo(id, normalizeFont(data));
  toast(`Abierta «${fontName(font)}»`);
});

$("newFont").addEventListener("click", () => {
  $("newFontName").value = "Nueva tipografía";
  $("newFontGrid").value = font.grid;
  const dialog = $("newFontDialog");
  dialog.returnValue = "";
  dialog.onclose = () => {
    if (dialog.returnValue !== "create") return;
    const family = $("newFontName").value.trim() || "Nueva tipografía";
    switchTo(newId(), createBlankFont({ family, grid: $("newFontGrid").value }));
    toast(`Nueva tipografía «${family}». La anterior quedó guardada en la lista.`);
  };
  dialog.showModal();
  $("newFontName").select();
});

$("saveFont").addEventListener("click", () => {
  persist();
  if (!saveFailed) toast(`«${fontName(font)}» guardada en este navegador`);
});

$("duplicateFont").addEventListener("click", () => {
  const copy = normalizeFont(JSON.parse(JSON.stringify(font)));
  copy.meta.family = `${copy.meta.family} copia`;
  switchTo(newId(), copy);
  toast(`Ahora trabajas en «${fontName(font)}»; el original quedó guardado`);
});

$("deleteFont").addEventListener("click", async () => {
  const name = fontName(font);
  const sure = await confirmAction({
    title: "Eliminar tipografía",
    message: `¿Eliminar «${name}» de este navegador? No se puede deshacer. Si quieres conservarla, descarga antes el .json.`,
    ok: "Eliminar",
  });
  if (!sure) return;
  deleteFont(storage, library, library.active);
  const next = library.fonts[0];
  const data = next && loadFont(storage, next.id);
  // switchTo saves the open font first, so point it at the next one now.
  library.active = next ? next.id : newId();
  font = data ? normalizeFont(data) : createBlankFont();
  switchTo(library.active, font);
  toast(`Eliminada «${name}»`);
});

// --- Export images (glyph or test text) ---
function exportSvg() {
  const svg = el("svg", { xmlns: SVG_NS });
  const metrics = $("exportMetrics").checked;
  if ($("exportTarget").value === "text") {
    const t = font.view.test;
    drawText(svg, font, t.text, {
      size: t.size, metrics,
      ink: t.inverted ? font.view.paper : font.view.ink,
      paper: t.inverted ? font.view.ink : font.view.paper,
    });
    svg.querySelectorAll(".t-hit").forEach((n) => n.remove());
    return { svg, name: `${baseName()}-prueba` };
  }
  drawGlyph(svg, font, glyph(), { guides: $("exportGrid").checked, metrics, labels: metrics });
  const [, , w, h] = svg.getAttribute("viewBox").split(" ").map(Number);
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  return { svg, name: fileName(font.active) };
}

function download(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

$("svg").addEventListener("click", () => {
  const { svg, name } = exportSvg();
  downloadBlob(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }), `${name}.svg`);
});

$("png").addEventListener("click", () => {
  const { svg, name } = exportSvg();
  const img = new Image();
  img.onload = () => {
    // About 2000 px tall for a glyph; text keeps its width up to 8000 px.
    const scale = Math.min(2000 / img.height, 8000 / img.width, 6);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    download(canvas.toDataURL("image/png"), `${name}.png`);
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
});

$("exportTarget").addEventListener("change", (e) => { $("exportGrid").disabled = e.target.value === "text"; });

buildMetricInputs();
buildToolbar();
setTool("draw");
refreshAll();
