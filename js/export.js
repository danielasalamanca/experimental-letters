// "Exportar": the font files (.otf, variable .ttf, .woff) and images of the
// glyph or the test text (SVG, PNG), plus the file helpers they share with
// the project files. The editor passes in what it owns (see initExport).

import { drawGlyph, drawText, el, SVG_NS } from "./render.js";
import { fileName } from "./charset.js";
import { mastersReport, normalizeAxis, instances, weightName } from "./masters.js";

const $ = (id) => document.getElementById(id);

// File-name-safe "Familia-Estilo".
export function baseName(font, withStyle = true) {
  const clean = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "");
  const family = clean(font.meta.family) || "LetrasExperimentales";
  return withStyle ? [family, clean(font.meta.style) || "Regular"].join("-") : family;
}

function download(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  download(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The "Fuente" choices: every named weight as a static font, and the variable one.
export function syncExportKinds(font) {
  const axis = normalizeAxis(font.axis);
  const kind = $("exportKind");
  const current = kind.value;
  kind.replaceChildren(
    ...instances(axis).map((i) => new Option(i.name, `static:${i.weight}`)),
    new Option("Variable, todos los pesos", "variable"),
  );
  kind.value = [...kind.options].some((o) => o.value === current) ? current : `static:${axis.min}`;
  syncExportInfo();
}

function syncExportInfo() {
  const variable = $("exportKind").value === "variable";
  const web = $("exportFormat").value === "web";
  const file = web ? ".woff" : variable ? ".ttf" : ".otf";
  const what = web
    ? `Un archivo <strong>${file}</strong> para usar en sitios web con @font-face.`
    : `Un archivo <strong>${file}</strong> para instalar en el computador.`;
  $("exportKindInfo").innerHTML = (variable ? "Una sola fuente con todos los pesos entre los dos másteres. " : "")
    + `${what} Se descarga con <strong>Exportar fuente</strong>, arriba a la derecha.`;
}

// Builds and downloads the chosen font file; returns the message to show.
async function exportFont(font) {
  const kind = $("exportKind").value;
  const web = $("exportFormat").value === "web";
  // Web fonts are the same font with its tables compressed (see woff.js).
  const save = async (buffer, name, type) => {
    if (!web) return downloadBlob(new Blob([buffer], { type: `font/${type}` }), `${name}.${type}`);
    const { sfntToWoff } = await import("./woff.js");
    downloadBlob(new Blob([await sfntToWoff(buffer)], { type: "font/woff" }), `${name}.woff`);
  };
  const webTip = (file) => ` Úsala en tu sitio con @font-face { src: url("${file}.woff") format("woff"); }.`;
  if (kind === "variable") {
    const { buildVariableTtf } = await import("./variable.js");
    const name = `${baseName(font, false)}-Variable`;
    await save(await buildVariableTtf(font), name, "ttf");
    const bad = mastersReport(font, Object.keys(font.glyphs)).incompatible;
    return (web ? "Fuente variable web exportada." + webTip(name) : "Fuente variable exportada.")
      + (bad.length ? ` ${bad.length} letra(s) no compatibles quedan iguales en todos los pesos: ${bad.join(" ")}` : "");
  }
  const weight = +kind.split(":")[1];
  const axis = normalizeAxis(font.axis);
  const { buildOtf } = await import("./otf.js");
  const name = weight === axis.min ? baseName(font) : `${baseName(font, false)}-${weightName(weight)}`;
  await save(await buildOtf(font, { mode: $("otfMode").value, weight }), name, "otf");
  return web ? "Fuente web exportada." + webTip(name)
    : "Fuente exportada. Instálala con doble clic para usarla en Illustrator o InDesign.";
}

// The glyph or the test text as an SVG element, with a file name.
function exportSvg(font, glyph) {
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
    return { svg, name: `${baseName(font)}-prueba` };
  }
  drawGlyph(svg, font, glyph, { guides: $("exportGrid").checked, metrics, labels: metrics });
  const [, , w, h] = svg.getAttribute("viewBox").split(" ").map(Number);
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  return { svg, name: fileName(font.active) };
}

// Wires the export controls. `getFont()` and `getGlyph()` give the open font
// and the glyph on the canvas (they change as the user works).
export function initExport({ getFont, getGlyph, toast }) {
  $("exportKind").addEventListener("change", syncExportInfo);
  $("exportFormat").addEventListener("change", syncExportInfo);

  $("exportOtf").addEventListener("click", async () => {
    const button = $("exportOtf");
    button.disabled = true;
    const label = button.innerHTML;
    button.textContent = "Generando…";
    try {
      toast(await exportFont(getFont()));
    } catch (err) {
      console.error(err);
      toast(`No se pudo exportar la fuente: ${err.message}`);
    } finally {
      button.disabled = false;
      button.innerHTML = label;
    }
  });

  $("svg").addEventListener("click", () => {
    const { svg, name } = exportSvg(getFont(), getGlyph());
    downloadBlob(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }), `${name}.svg`);
  });

  $("png").addEventListener("click", () => {
    const { svg, name } = exportSvg(getFont(), getGlyph());
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
}
