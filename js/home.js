// Home page ("Mis tipografías"): a card for every font saved in the browser.
// It gets what it needs from main.js through initHome({ … }) and only draws
// the cards and reports what was clicked.

import { drawText } from "./render.js";

const INK = "#111111";

// Marks the fonts whose letters are drawn, and how many: the card shows it.
const drawnCount = (font) =>
  Object.values(font.glyphs ?? {}).filter((g) => g.cells?.length || g.outline?.length || g.pieces?.length).length;

const isDrawn = (g) => !!(g && (g.cells?.length || g.outline?.length || g.pieces?.length));

// What the preview spells: the font's name if its letters are drawn, else
// the first characters that are (letters before figures and signs).
function previewText(font, name) {
  const spell = [...name].filter((c) => c === " " || isDrawn(font.glyphs?.[c])).join("").trim();
  if (spell.replace(/ /g, "").length >= Math.min(4, name.replace(/ /g, "").length)) return spell.slice(0, 22);
  // Object keys list the figures first, so the letters are moved to the front.
  const drawn = Object.keys(font.glyphs ?? {}).filter((k) => [...k].length === 1 && isDrawn(font.glyphs[k]));
  const isLetter = (k) => /\p{L}/u.test(k);
  return [...drawn.filter(isLetter), ...drawn.filter((k) => !isLetter(k))].slice(0, 8).join("");
}

const when = (time) => {
  if (!time) return "";
  const d = new Date(time);
  const day = d.toLocaleDateString("es", { day: "numeric", month: "short" });
  const hour = d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${hour}`;
};

export function initHome({ grid, empty, getLibrary, getFont, onOpen, onDuplicate, onDelete }) {
  // The previews are redrawn only when a font has been saved again.
  const previews = new Map(); // id -> { key, html }

  function previewHtml(entry, font) {
    const key = `${entry.id}|${entry.updated}|${entry.name}`;
    const hit = previews.get(entry.id);
    if (hit?.key === key) return hit.html;
    let html = "";
    try {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      drawText(svg, font, previewText(font, font.meta?.family || entry.name), { size: 64, ink: INK, paper: "none" });
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      html = svg.outerHTML;
    } catch {
      html = "";
    }
    previews.set(entry.id, { key, html });
    return html;
  }

  function card(entry) {
    const font = getFont(entry.id);
    const node = document.createElement("article");
    node.className = "home-card";
    node.dataset.id = entry.id;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "home-open";
    open.setAttribute("aria-label", `Abrir ${entry.name}`);
    const preview = document.createElement("div");
    preview.className = "home-preview";
    if (font) preview.innerHTML = previewHtml(entry, font);
    open.appendChild(preview);
    open.addEventListener("click", () => onOpen(entry.id));
    const meta = document.createElement("div");
    meta.className = "home-meta";
    const name = document.createElement("strong");
    name.textContent = entry.name;
    const info = document.createElement("span");
    info.className = "mono";
    const drawn = font ? drawnCount(font) : 0;
    info.textContent = [drawn ? `${drawn} letra${drawn === 1 ? "" : "s"} dibujada${drawn === 1 ? "" : "s"}` : "sin letras todavía", when(entry.updated)]
      .filter(Boolean).join(" · ");
    meta.append(name, info);
    const actions = document.createElement("div");
    actions.className = "home-card-actions";
    const dup = document.createElement("button");
    dup.type = "button";
    dup.textContent = "Duplicar";
    dup.addEventListener("click", () => onDuplicate(entry.id));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = "Eliminar";
    del.addEventListener("click", () => onDelete(entry.id));
    actions.append(dup, del);
    node.append(open, meta, actions);
    return node;
  }

  function render() {
    const { fonts } = getLibrary();
    const sorted = [...fonts].sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
    grid.replaceChildren(...sorted.map(card));
    empty.hidden = sorted.length > 0;
    const ids = new Set(sorted.map((f) => f.id));
    for (const id of previews.keys()) if (!ids.has(id)) previews.delete(id);
  }

  return { render };
}
