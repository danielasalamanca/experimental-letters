// Grid letter maker: each filled vertex draws the negative space between
// the four circles that surround it (a concave four-pointed star).

const CELL = 100;
const SVG_NS = "http://www.w3.org/2000/svg";
const STORAGE_KEY = "experimental-letters";

const $ = (id) => document.getElementById(id);
const board = $("board");

// Letter from the reference sketch (9 x 10 cells), as "x,y" vertex keys.
const SAMPLE = [
  [3,1],[4,1],[5,1],[6,1],
  [2,2],[6,2],[7,2],
  [2,3],[3,3],[6,3],[7,3],
  [6,4],[7,4],
  [2,5],[3,5],[4,5],[5,5],[6,5],[7,5],
  [1,6],[2,6],[6,6],[7,6],
  [1,7],[2,7],[6,7],[7,7],
  [1,8],[2,8],[3,8],[5,8],[6,8],[7,8],
  [2,9],[3,9],[4,9],[7,9],[8,9],
].map(([x, y]) => `${x},${y}`);

const stored = load();
const state = {
  cols: 9,
  rows: 10,
  curve: 1,
  ink: "#1d1d1b",
  paper: "#ffffff",
  guides: true,
  filled: new Set(SAMPLE),
  gallery: [],
  ...stored,
};
state.filled = new Set(stored?.filled ?? SAMPLE);

const history = [];

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, filled: [...state.filled] }));
  } catch {}
}

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// Square around the vertex minus four corner circles of radius r.
function starPath(cx, cy, curve) {
  const h = CELL / 2;
  const r = h * curve;
  const L = cx - h, R = cx + h, T = cy - h, B = cy + h;
  return [
    `M${L + r},${T}`, `L${R - r},${T}`,
    `A${r},${r} 0 0 0 ${R},${T + r}`, `L${R},${B - r}`,
    `A${r},${r} 0 0 0 ${R - r},${B}`, `L${L + r},${B}`,
    `A${r},${r} 0 0 0 ${L},${B - r}`, `L${L},${T + r}`,
    `A${r},${r} 0 0 0 ${L + r},${T}`, "Z",
  ].join(" ");
}

// Builds the letter SVG. Used for the editor, the gallery and exports.
function buildSvg(target, { cols, rows, curve, ink, paper, filled }, { guides = false, hits = false } = {}) {
  const w = cols * CELL, h = rows * CELL;
  target.setAttribute("viewBox", `0 0 ${w} ${h}`);
  target.replaceChildren();
  target.appendChild(el("rect", { width: w, height: h, fill: paper }));

  if (guides) {
    const g = el("g", { fill: "none", stroke: "#c8c8c8", "stroke-width": 1, "vector-effect": "non-scaling-stroke" });
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        g.appendChild(el("rect", { x: x * CELL, y: y * CELL, width: CELL, height: CELL }));
        g.appendChild(el("circle", { cx: x * CELL + CELL / 2, cy: y * CELL + CELL / 2, r: CELL / 2 }));
      }
    }
    target.appendChild(g);
  }

  const shapes = el("g", { fill: ink });
  for (const key of filled) {
    const [x, y] = key.split(",").map(Number);
    if (x < 1 || y < 1 || x >= cols || y >= rows) continue;
    shapes.appendChild(el("path", { d: starPath(x * CELL, y * CELL, curve) }));
  }
  target.appendChild(shapes);

  if (hits) {
    const g = el("g", { class: "hits" });
    for (let x = 1; x < cols; x++) {
      for (let y = 1; y < rows; y++) {
        g.appendChild(el("circle", {
          cx: x * CELL, cy: y * CELL, r: CELL * 0.35,
          fill: "transparent", "data-key": `${x},${y}`,
        }));
      }
    }
    target.appendChild(g);
  }
  return target;
}

function render() {
  buildSvg(board, state, { guides: state.guides, hits: true });
  $("colsOut").textContent = state.cols;
  $("rowsOut").textContent = state.rows;
  $("curveOut").textContent = Math.round(state.curve * 100) + "%";
  persist();
}

function renderGallery() {
  const gallery = $("gallery");
  gallery.replaceChildren();
  state.gallery.forEach((letter, i) => {
    const svg = buildSvg(el("svg"), { ...letter, filled: letter.filled });
    svg.addEventListener("click", () => {
      snapshot();
      Object.assign(state, { ...letter, filled: new Set(letter.filled) });
      syncControls();
      render();
    });
    svg.addEventListener("dblclick", () => {
      state.gallery.splice(i, 1);
      renderGallery();
      persist();
    });
    gallery.appendChild(svg);
  });
}

function snapshot() {
  history.push({ cols: state.cols, rows: state.rows, filled: [...state.filled] });
  if (history.length > 100) history.shift();
}

// --- Drawing with pointer (click or drag) ---
let painting = null; // true = add, false = erase

function keyAt(evt) {
  const target = document.elementFromPoint(evt.clientX, evt.clientY);
  return target?.dataset?.key ?? null;
}

function paint(key) {
  if (!key) return;
  if (painting) state.filled.add(key);
  else state.filled.delete(key);
  render();
}

board.addEventListener("pointerdown", (evt) => {
  const key = keyAt(evt);
  if (!key) return;
  snapshot();
  painting = !state.filled.has(key);
  paint(key);
});
window.addEventListener("pointermove", (evt) => {
  if (painting === null) return;
  const key = keyAt(evt);
  if (key && state.filled.has(key) !== painting) paint(key);
});
window.addEventListener("pointerup", () => { painting = null; });

// --- Controls ---
function syncControls() {
  $("cols").value = state.cols;
  $("rows").value = state.rows;
  $("curve").value = Math.round(state.curve * 100);
  $("ink").value = state.ink;
  $("paper").value = state.paper;
  $("guides").checked = state.guides;
}

$("cols").addEventListener("input", (e) => { state.cols = +e.target.value; render(); });
$("rows").addEventListener("input", (e) => { state.rows = +e.target.value; render(); });
$("curve").addEventListener("input", (e) => { state.curve = e.target.value / 100; render(); });
$("ink").addEventListener("input", (e) => { state.ink = e.target.value; render(); });
$("paper").addEventListener("input", (e) => { state.paper = e.target.value; render(); });
$("guides").addEventListener("change", (e) => { state.guides = e.target.checked; render(); });

$("undo").addEventListener("click", () => {
  const prev = history.pop();
  if (!prev) return;
  Object.assign(state, prev, { filled: new Set(prev.filled) });
  syncControls();
  render();
});

$("clear").addEventListener("click", () => {
  snapshot();
  state.filled.clear();
  render();
});

$("invert").addEventListener("click", () => {
  snapshot();
  const next = new Set();
  for (let x = 1; x < state.cols; x++) {
    for (let y = 1; y < state.rows; y++) {
      const key = `${x},${y}`;
      if (!state.filled.has(key)) next.add(key);
    }
  }
  state.filled = next;
  render();
});

$("save").addEventListener("click", () => {
  const { cols, rows, curve, ink, paper } = state;
  state.gallery.push({ cols, rows, curve, ink, paper, filled: [...state.filled] });
  renderGallery();
  persist();
});

// --- Export ---
function exportSvgString() {
  const svg = buildSvg(el("svg", { xmlns: SVG_NS }), state, { guides: state.guides });
  svg.setAttribute("width", state.cols * CELL);
  svg.setAttribute("height", state.rows * CELL);
  return new XMLSerializer().serializeToString(svg);
}

function download(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

$("svg").addEventListener("click", () => {
  const blob = new Blob([exportSvgString()], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  download(url, "letra.svg");
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$("png").addEventListener("click", () => {
  const scale = 2;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = state.cols * CELL * scale;
    canvas.height = state.rows * CELL * scale;
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    download(canvas.toDataURL("image/png"), "letra.png");
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(exportSvgString());
});

syncControls();
render();
renderGallery();
