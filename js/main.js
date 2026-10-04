// Editor UI: wires the panels and the canvas to the font model.

import { key } from "./geometry.js";
import {
  METRICS, createGlyph, normalizeFont, glyphCurve, setMetric,
  sameMetrics, planFit, applyFit,
} from "./model.js";
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
  syncControls();
  render();
  renderGallery();
}
const undo = () => restore(undoStack, redoStack);
const redo = () => restore(redoStack, undoStack);

// --- Rendering ---
let bounds = null;       // what the canvas currently shows
let frozenBounds = null; // kept fixed while dragging so the view doesn't jump

function render() {
  bounds = drawGlyph(board, font, glyph(), {
    guides: font.view.guides,
    metrics: font.view.metrics,
    labels: true,
    bounds: frozenBounds,
  });
  updateInfo();
  persist();
}

function renderGallery() {
  const gallery = $("gallery");
  gallery.replaceChildren();
  font.drafts.forEach((draft, i) => {
    const item = document.createElement("div");
    item.className = "thumb";
    item.title = "Clic para cargar · doble clic para borrar";
    const svg = drawThumb(draft);
    item.appendChild(svg);
    if (draft.curve != null) {
      const dot = document.createElement("span");
      dot.className = "own-dot";
      dot.title = "Usa curvatura propia";
      item.appendChild(dot);
    }
    item.addEventListener("click", () => {
      checkpoint();
      font.glyphs[font.active] = createGlyph(draft);
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

function drawThumb(g) {
  const svg = document.createElementNS(SVG_NS, "svg");
  drawGlyph(svg, font, g, {});
  return svg;
}

// --- Pointer: painting cells and dragging metric labels ---
let painting = null;     // true = add, false = erase
let dragMetric = null;

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
  const label = evt.target.closest?.(".metric-label.draggable");
  frozenBounds = bounds;
  if (label) {
    checkpoint();
    dragMetric = label.dataset.metric;
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
      render();
    }
  } else if (painting !== null) {
    const k = cellAt(evt);
    if (k) paint(k);
  }
});

window.addEventListener("pointerup", () => {
  if (painting === null && !dragMetric) return;
  painting = null;
  dragMetric = null;
  frozenBounds = null;
  render();
});

// --- Panels ---
function buildMetricInputs() {
  const box = $("metricInputs");
  for (const def of METRICS) {
    const label = document.createElement("label");
    label.className = "row metric";
    label.innerHTML = `<span><i style="background:${def.color}"></i>${def.name}</span>`;
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
        render();
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
  $("cols").value = g.cols;
  $("colsOut").textContent = g.cols;
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
function bind(id, event, apply, tag = id) {
  $(id).addEventListener(event, (e) => {
    checkpoint(tag);
    apply(e.target);
    syncControls();
    render();
  });
}

bind("cols", "input", (t) => { glyph().cols = +t.value; });
bind("cell", "change", (t) => { font.cell = clampNum(+t.value, 5, 250, font.cell); });
bind("upm", "change", (t) => { font.upm = clampNum(Math.round(+t.value), 16, 16384, font.upm); });
bind("guides", "change", (t) => { font.view.guides = t.checked; });
bind("curve", "input", (t) => { font.curve = t.value / 100; });
bind("glyphCurve", "input", (t) => { glyph().curve = t.value / 100; });
bind("ownCurve", "click", () => { glyph().curve = font.curve; });
bind("useGlobal", "click", () => { glyph().curve = null; });
bind("join", "change", (t) => { font.join.enabled = t.checked; });
bind("joinWidth", "change", (t) => { font.join.width = clampNum(+t.value, 1, 250, font.join.width); });
bind("ink", "input", (t) => { font.view.ink = t.value; });
bind("paper", "input", (t) => { font.view.paper = t.value; });
bind("showMetrics", "change", (t) => { font.view.metrics = t.checked; });
bind("overshoot", "change", (t) => { font.overshoot = clampNum(+t.value, 0, 200, font.overshoot); });

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
  font.drafts.push(createGlyph(glyph()));
  renderGallery();
  persist();
});

$("fit").addEventListener("click", () => {
  const plan = planFit(font);
  if (plan.affected === 0) {
    checkpoint();
    applyFit(font, plan);
    render();
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
    render();
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
  download(url, `${font.active}.svg`);
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
    download(canvas.toDataURL("image/png"), `${font.active}.png`);
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
});

buildMetricInputs();
syncControls();
render();
renderGallery();
