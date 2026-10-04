// Editor UI: wires the character map, panels and canvas to the font model.

import { key, parseKey } from "./geometry.js";
import {
  METRICS, createGlyph, normalizeFont, glyphCurve, setMetric, sameMetrics,
  planFit, applyFit, advanceWidth, resolvedCells, canUseComponent, dependents,
  kerningValue, setKerning, layoutText,
} from "./model.js";
import { GROUPS, CHARSET, glyphName, fileName, codepoint } from "./charset.js";
import { drawGlyph, drawText, el, SVG_NS } from "./render.js";
import { AXES, axisRows, mirrorKeys, translate, cellsInRect, connectedCells } from "./tools.js";

const STORAGE_KEY = "experimental-letters:v2";
const LEGACY_KEY = "experimental-letters";

const $ = (id) => document.getElementById(id);
const board = $("board");

let font = normalizeFont(load());
const glyph = () => font.glyphs[font.active];

// --- Storage ---
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(font));
  } catch {}
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
  });
  const vb = board.viewBox.baseVal;
  fitBox = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
  if (zoomBox) board.setAttribute("viewBox", `${zoomBox.x} ${zoomBox.y} ${zoomBox.w} ${zoomBox.h}`);
  decorate();
  $("zoomLevel").textContent = Math.round((fitBox.w / (zoomBox ?? fitBox).w) * 100) + "%";
  updateInfo();
  if (scope === "font") renderCharmap();
  else if (scope === "glyph") dependents(font, font.active).forEach(updateThumb);
  if (scope) scheduleTest();
  persist();
}

function refreshAll() {
  selection.clear();
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
  const empty = resolvedCells(font, g).length === 0;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  drawGlyph(svg, font, g, { frame: "advance" });
  const label = document.createElement("span");
  label.className = "cm-label";
  label.textContent = char === " " ? "esp" : char;
  cell.replaceChildren(svg, label);
  if (g.curve != null) cell.appendChild(marker("own-dot", "Usa curvatura propia"));
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
    if (draft.curve != null) item.appendChild(marker("own-dot", "Usa curvatura propia"));
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
  tool = next;
  if (tool === "draw") selection.clear();
  $("toolDraw").classList.toggle("active", tool === "draw");
  $("toolSelect").classList.toggle("active", tool === "select");
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
  render(done.type === "metric" ? "font" : "glyph");
});

// Double-click with the select tool picks the whole stroke.
board.addEventListener("dblclick", (evt) => {
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
  for (const [value, name] of Object.entries(AXES)) {
    $("mirrorAxis").appendChild(new Option(name, value));
  }
  $("background").appendChild(new Option("Ninguno", ""));
  for (const char of CHARSET) {
    $("background").appendChild(new Option(charLabel(char), char));
  }
}

function syncToolbar() {
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
    else if (k === "a") {
      e.preventDefault();
      setTool("select");
      glyph().cells.forEach((c) => selection.add(c));
      render(null);
    }
    return;
  }
  const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, 1], arrowdown: [0, -1] };
  if (arrows[k] && selection.size) { e.preventDefault(); nudge(...arrows[k]); }
  else if (k === "delete" || k === "backspace") { if (selection.size) { e.preventDefault(); deleteSelection(); } }
  else if (k === "escape") { selection.clear(); render(null); }
  else if (k === "b") setTool("draw");
  else if (k === "v") setTool("select");
  else if (k === "+" || k === "=") zoomAt(1.25);
  else if (k === "-") zoomAt(0.8);
  else if (k === "0") zoomFit();
  else if (k === " ") {
    e.preventDefault();
    spaceDown = true;
    board.classList.add("pan-ready");
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key === " ") {
    spaceDown = false;
    board.classList.remove("pan-ready");
  }
});

// --- Glyph panel ---
function syncGlyphPanel() {
  const g = glyph();
  const char = font.active;
  $("glyphChar").textContent = char === " " ? "␣" : char;
  $("glyphName").textContent = glyphName(char);
  $("glyphCode").textContent = codepoint(char);
  $("cols").value = g.cols;
  $("colsOut").textContent = g.cols;
  $("lsb").value = g.lsb;
  $("rsb").value = g.rsb;
  $("advanceInfo").textContent =
    `Ancho de avance: ${advanceWidth(font, g)} u = ${g.lsb} + ${g.cols} × ${font.cell} + ${g.rsb}`;
  renderComponents();
}

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
    const empty = resolvedCells(font, font.glyphs[char]).length === 0;
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
  $("curve").value = Math.round(font.curve * 100);
  $("curveOut").textContent = Math.round(font.curve * 100) + "%";
  const own = g.curve != null;
  $("glyphCurveGlobal").hidden = own;
  $("glyphCurveOwn").hidden = !own;
  $("glyphCurve").value = Math.round(glyphCurve(font, g) * 100);
  $("glyphCurveOut").textContent = Math.round(glyphCurve(font, g) * 100) + "%";
  $("join").checked = font.join.enabled;
  $("joinWidth").value = font.join.width;
  $("joinWidth").disabled = !font.join.enabled;
  $("ink").value = font.view.ink;
  $("paper").value = font.view.paper;
  $("showMetrics").checked = font.view.metrics;
  $("overshoot").value = font.overshoot;
  syncMetricInputs();
  syncToolbar();
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
bind("curve", "input", (t) => { font.curve = t.value / 100; }, "font");
bind("glyphCurve", "input", (t) => { glyph().curve = t.value / 100; });
bind("ownCurve", "click", () => { glyph().curve = font.curve; });
bind("useGlobal", "click", () => { glyph().curve = null; });
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
  font.drafts.push(createGlyph({ ...g, cells: resolvedCells(font, g), components: [] }));
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

// --- Export ---
function exportSvgString() {
  const svg = el("svg", { xmlns: SVG_NS });
  drawGlyph(svg, font, glyph(), { guides: font.view.guides, metrics: font.view.metrics, labels: font.view.metrics });
  const [, , w, h] = svg.getAttribute("viewBox").split(" ").map(Number);
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  return new XMLSerializer().serializeToString(svg);
}

function download(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

$("svg").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([exportSvgString()], { type: "image/svg+xml" }));
  download(url, `${fileName(font.active)}.svg`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$("png").addEventListener("click", () => {
  const svgText = exportSvgString();
  const img = new Image();
  img.onload = () => {
    const scale = 2000 / img.height;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = 2000;
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    download(canvas.toDataURL("image/png"), `${fileName(font.active)}.png`);
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
});

buildMetricInputs();
buildToolbar();
setTool("draw");
refreshAll();
