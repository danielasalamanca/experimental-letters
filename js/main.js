// Editor UI: wires the character map, panels and canvas to the font model.

import { key } from "./geometry.js";
import {
  METRICS, createGlyph, normalizeFont, glyphCurve, setMetric, sameMetrics,
  planFit, applyFit, advanceWidth, resolvedCells, canUseComponent, dependents,
} from "./model.js";
import { GROUPS, CHARSET, glyphName, fileName, codepoint } from "./charset.js";
import { drawGlyph, el, SVG_NS } from "./render.js";

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

// Redraws the canvas. `scope` says which thumbnails are stale:
// "glyph" = the active glyph and the composites using it, "font" = all.
function render(scope = "glyph") {
  bounds = drawGlyph(board, font, glyph(), {
    guides: font.view.guides,
    metrics: font.view.metrics,
    labels: true,
    components: true,
    bounds: frozenBounds,
  });
  updateInfo();
  if (scope === "font") renderCharmap();
  else if (scope === "glyph") dependents(font, font.active).forEach(updateThumb);
  persist();
}

function refreshAll() {
  syncControls();
  render("font");
  renderGallery();
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

// --- Pointer: painting cells, dragging metrics and sidebearings ---
let painting = null;     // true = add, false = erase
let dragMetric = null;
let dragSide = null;

function toUnits(evt) {
  const p = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(board.getScreenCTM().inverse());
  return { x: p.x, y: -p.y };
}

function cellAt(evt) {
  const { x, y } = toUnits(evt);
  const c = Math.floor(x / font.cell), r = Math.floor(y / font.cell);
  if (c < 0 || c >= bounds.cols || r < bounds.lo || r >= bounds.hi) return null;
  return key(c, r);
}

function paint(k) {
  const g = glyph();
  const has = g.cells.includes(k);
  if (painting && !has) g.cells.push(k);
  else if (!painting && has) g.cells = g.cells.filter((x) => x !== k);
  else return;
  render();
}

board.addEventListener("pointerdown", (evt) => {
  frozenBounds = bounds;
  const metric = evt.target.closest?.(".metric-label.draggable");
  const side = evt.target.closest?.(".sb-label");
  if (metric || side) {
    checkpoint();
    dragMetric = metric?.dataset.metric ?? null;
    dragSide = side?.dataset.sb ?? null;
    return;
  }
  const k = cellAt(evt);
  if (!k) { frozenBounds = null; return; }
  checkpoint();
  const g = glyph();
  // An empty glyph is always drawn against the current metrics.
  if (g.cells.length === 0) g.metrics = { ...font.metrics };
  painting = !g.cells.includes(k);
  paint(k);
});

window.addEventListener("pointermove", (evt) => {
  if (dragMetric) {
    const rows = Math.round(toUnits(evt).y / font.cell);
    const next = setMetric(font.metrics, dragMetric, Math.min(bounds.hi, Math.max(bounds.lo, rows)));
    if (!sameMetrics(next, font.metrics)) {
      font.metrics = next;
      syncMetricInputs();
      render(null);
    }
  } else if (dragSide) {
    // Sidebearings snap to tenths of a cell while dragging.
    const step = font.cell / 10;
    const x = Math.min(bounds.right, Math.max(bounds.left, toUnits(evt).x));
    const g = glyph();
    const value = dragSide === "lsb"
      ? Math.round(-x / step) * step
      : Math.round((x - g.cols * font.cell) / step) * step;
    if (value !== g[dragSide]) {
      g[dragSide] = value;
      syncGlyphPanel();
      render();
    }
  } else if (painting !== null) {
    const k = cellAt(evt);
    if (k) paint(k);
  }
});

window.addEventListener("pointerup", () => {
  if (painting === null && !dragMetric && !dragSide) return;
  const metricsChanged = !!dragMetric;
  painting = null;
  dragMetric = null;
  dragSide = null;
  frozenBounds = null;
  render(metricsChanged ? "font" : "glyph");
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
    const shown = char === " " ? "␣" : char;
    opt.textContent = glyphName(char) === char ? shown : `${shown}  ${glyphName(char)}`;
    select.appendChild(opt);
  }
  $("decompose").disabled = g.components.length === 0;
}

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

window.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
  if (e.target.matches?.("input[type=number], input[type=text], textarea")) return;
  e.preventDefault();
  if (e.shiftKey) redo();
  else undo();
});

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
refreshAll();
