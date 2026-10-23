// "Prueba": the text set in the font, at any weight, and kerning — pick a
// pair by clicking between two letters, then adjust it (its own value or its
// groups', see model.js). The editor passes in what it owns (see initTestbar).

import { drawText } from "./render.js";
import {
  layoutText, capitalOf, kerningValue, setKerning, removeKerning, setGroupKerning, kerningTarget,
  pairGroups, kernGroup, groupMembers,
} from "./model.js";
import { atWeight, normalizeAxis, instances } from "./masters.js";

const $ = (id) => document.getElementById(id);

const PRESETS = [
  "hamburgefonstiv",
  "HOHOHOH nonono",
  "Hamburgefonstiv",
  "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ",
  "abcdefghijklmnñopqrstuvwxyz",
  "0123456789 .,;:!?-'\"()",
  "AV To Ta Ye LT Wa",
  "El veloz murciélago hindú comía feliz cardillo y kiwi.",
  "ÁRBOL ÉPOCA ÍNDICE ÓPERA ÚLTIMO ÑANDÚ",
  "niño año ñandú canción",
];
const KERN_STEP = 10;
const TEST_KEY = "experimental-letters:test-hidden";

// Wires the test bar. `getFont()` gives the open font; `checkpoint`,
// `persist` and `updateInfo` are the editor's undo step, save and status;
// `selectGlyph` opens a letter; `isEmptyGlyph` tells drawn letters apart.
// Returns what the editor calls: renderTest, scheduleTest, clearPair and
// toggle (show or hide the bar).
export function initTestbar({ getFont, checkpoint, persist, updateInfo, toast, selectGlyph, isEmptyGlyph }) {
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
    const font = getFont();
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
    const axis = normalizeAxis(font.axis);
    const weight = Math.min(axis.max, Math.max(axis.min, t.weight ?? axis.min));
    testLayout = drawText($("testSvg"), font, t.text, {
      size: t.size, ink, paper, pair: kernPair?.line != null ? kernPair : null,
      weighted: weight > axis.min ? (char) => atWeight(font, char, weight) : null,
    });
    $("testView").style.background = paper;
    // How many of the characters in the text are drawn.
    const chars = [...new Set([...t.text].map((c) => capitalOf(font, c) ?? c).filter((c) => c.trim() && font.glyphs[c]))];
    const drawn = chars.filter((c) => !isEmptyGlyph(font.glyphs[c])).length;
    $("testCount").textContent = chars.length ? `${drawn} de ${chars.length} dibujada${chars.length === 1 ? "" : "s"}` : "";
    syncTestControls();
  }

  function syncTestControls() {
    const font = getFont();
    const t = font.view.test;
    if ($("testText").value !== t.text) $("testText").value = t.text;
    document.querySelectorAll(".segmented [data-size]").forEach((b) => b.classList.toggle("active", +b.dataset.size === t.size));
    $("testInvert").classList.toggle("active", t.inverted);
    $("testInvert").setAttribute("aria-pressed", t.inverted);

    const has = !!kernPair;
    $("kernPair").textContent = has ? `${kernPair.left}${kernPair.right}` : "—";
    $("kernValue").value = has ? kerningValue(font, kernPair.left, kernPair.right) : "";
    for (const id of ["kernMinus", "kernValue", "kernPlus", "kernClear"]) $(id).disabled = !has;
    // Whether the value belongs to the pair's groups or to the pair alone.
    const groups = has ? pairGroups(font, kernPair.left, kernPair.right) : null;
    const scope = $("kernScope");
    scope.hidden = !groups;
    if (groups) {
      const pair = `${kernPair.left}${kernPair.right}`;
      const onGroups = kerningTarget(font, kernPair.left, kernPair.right) === "group";
      scope.textContent = onGroups ? `Grupos ${groups[0]} · ${groups[1]}` : `Solo ${pair}`;
      scope.classList.toggle("exception", !onGroups);
      scope.title = onGroups
        ? `Cambia todos los pares de los grupos ${groups[0]} y ${groups[1]}. Clic: excepción solo para ${pair}`
        : `Excepción: solo ${pair}. Clic: volver al kerning de los grupos ${groups[0]} · ${groups[1]}`;
    }

    const list = $("kernList");
    list.replaceChildren();
    const chip = (text, active, title, pick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "kern-chip";
      b.classList.toggle("active", active);
      b.textContent = text;
      if (title) b.title = title;
      b.addEventListener("click", () => { pick(); renderTest(); });
      list.appendChild(b);
      return b;
    };
    const signed = (v) => `${v > 0 ? "+" : ""}${v}`;
    // Picks the pair in the text if it's there.
    const pickPair = (left, right) => {
      const at = testLayout.items.find((it, i, all) => it.char === left && all[i + 1]?.char === right && all[i + 1].line === it.line);
      kernPair = at ? { left, right, line: at.line, index: at.index } : { left, right };
    };
    for (const [a, row] of Object.entries(font.groupKerning)) {
      for (const [b, value] of Object.entries(row)) {
        const active = has && groups?.[0] === a && groups?.[1] === b && kerningTarget(font, kernPair.left, kernPair.right) === "group";
        chip(`${a}·${b} ${signed(value)}`, active, `Grupos ${a} (lado derecho) y ${b} (lado izquierdo)`, () => {
          // A pair of the groups in the text, else their first letters.
          const at = testLayout.items.find((it, i, all) => all[i + 1]?.line === it.line
            && kernGroup(font, it.char, "right") === a && kernGroup(font, all[i + 1].char, "left") === b);
          if (at) pickPair(at.char, testLayout.items[testLayout.items.indexOf(at) + 1].char);
          else kernPair = { left: groupMembers(font, "right", a)[0], right: groupMembers(font, "left", b)[0] };
        }).classList.add("group");
      }
    }
    for (const [pair, value] of Object.entries(font.kerning)) {
      const [left, right] = [...pair];
      const exception = !!pairGroups(font, left, right);
      chip(`${pair} ${signed(value)}`, has && pair === kernPair.left + kernPair.right,
        exception ? `Excepción a los grupos de ${pair}` : null, () => pickPair(left, right))
        .classList.toggle("exception", exception);
    }
  }

  // After a kerning change: redraw, update the status and save.
  const kerningChanged = () => {
    renderTest();
    updateInfo();
    persist();
  };

  // The pair's value goes to its groups unless it is an exception (see kerningTarget).
  $("kernScope").addEventListener("click", () => {
    if (!kernPair) return;
    const font = getFont();
    const { left, right } = kernPair;
    checkpoint();
    if (kerningTarget(font, left, right) === "group") {
      font.kerning[left + right] = kerningValue(font, left, right);
      toast(`${left}${right} es ahora una excepción: cambiarla no toca a los grupos.`);
    } else {
      removeKerning(font, left, right);
      toast(`${left}${right} vuelve a usar el kerning de sus grupos.`);
    }
    kerningChanged();
  });

  function setPairKerning(value) {
    if (!kernPair) return;
    const font = getFont();
    checkpoint("kern");
    const { left, right } = kernPair;
    if (kerningTarget(font, left, right) === "group") setGroupKerning(font, ...pairGroups(font, left, right), value);
    else setKerning(font, left, right, value);
    kerningChanged();
  }

  const adjustKerning = (delta) => kernPair && setPairKerning(kerningValue(getFont(), kernPair.left, kernPair.right) + delta);

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
    if (item && getFont().glyphs[item.char]) selectGlyph(item.char);
  });

  $("testView").addEventListener("keydown", (evt) => {
    const step = evt.shiftKey ? KERN_STEP * 5 : KERN_STEP;
    if (evt.key === "ArrowLeft" && kernPair) { evt.preventDefault(); adjustKerning(-step); }
    else if (evt.key === "ArrowRight" && kernPair) { evt.preventDefault(); adjustKerning(step); }
    else if (evt.key === "Escape") { kernPair = null; renderTest(); }
  });

  // Settings of the test text (saved with the font, not undoable).
  const setTest = (change) => {
    change(getFont().view.test);
    renderTest();
    persist();
  };

  $("testText").addEventListener("input", (e) => setTest((t) => { t.text = e.target.value; }));

  $("testPreset").addEventListener("change", (e) => {
    if (!e.target.value) return;
    const text = e.target.value;
    e.target.value = "";
    kernPair = null;
    setTest((t) => { t.text = text; });
  });

  document.querySelectorAll(".segmented [data-size]").forEach((b) => {
    b.addEventListener("click", () => setTest((t) => { t.size = +b.dataset.size; }));
  });

  $("testWeight").addEventListener("input", (e) => {
    const named = instances(getFont().axis).find((i) => i.weight === +e.target.value);
    $("testWeightOut").textContent = named ? named.name : e.target.value;
    setTest((t) => { t.weight = +e.target.value; });
  });

  $("testInvert").addEventListener("click", () => setTest((t) => { t.inverted = !t.inverted; }));

  $("kernMinus").addEventListener("click", (e) => adjustKerning(e.shiftKey ? -KERN_STEP * 5 : -KERN_STEP));
  $("kernPlus").addEventListener("click", (e) => adjustKerning(e.shiftKey ? KERN_STEP * 5 : KERN_STEP));
  $("kernValue").addEventListener("change", (e) => setPairKerning(+e.target.value || 0));
  // "Quitar": an exception goes back to its groups; otherwise the value is removed.
  $("kernClear").addEventListener("click", () => {
    if (!kernPair) return;
    const font = getFont();
    const { left, right } = kernPair;
    if (font.kerning[left + right] !== undefined && pairGroups(font, left, right)) {
      checkpoint();
      removeKerning(font, left, right);
      kerningChanged();
    } else setPairKerning(0);
  });

  for (const text of PRESETS) $("testPreset").appendChild(new Option(text, text));

  // --- Collapsible test bar ---
  function setHidden(hidden) {
    $("testbar").classList.toggle("collapsed", hidden);
    const btn = $("toggleTest");
    const label = hidden ? "Mostrar la prueba de texto (T)" : "Ocultar la prueba de texto (T)";
    btn.title = label;
    btn.setAttribute("aria-label", label.replace(" (T)", ""));
    btn.setAttribute("aria-expanded", String(!hidden));
    try { localStorage.setItem(TEST_KEY, hidden ? "1" : "0"); } catch {}
  }
  const toggle = () => setHidden(!$("testbar").classList.contains("collapsed"));
  $("toggleTest").addEventListener("click", toggle);
  $("testbar").querySelector(".test-title").addEventListener("click", (e) => {
    if ($("testbar").classList.contains("collapsed")) { e.preventDefault(); setHidden(false); }
  });
  try { if (localStorage.getItem(TEST_KEY) === "1") setHidden(true); } catch {}

  return { renderTest, scheduleTest, clearPair: () => { kernPair = null; }, toggle };
}
