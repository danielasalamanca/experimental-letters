// "¿Por dónde empiezo?": a cheat sheet with the usual order for drawing a
// typeface. Control letters first (n o, H O) fix stem weight, curves and
// spacing; the rest reuse their parts. The editor passes in what it owns
// (see initGuide).

export const ORDER = [
  {
    title: "Letras de control: n y o",
    text: "La n fija el grosor de las astas, el ancho y el espaciado de las minúsculas; la o, las curvas y el overshoot. Casi todo lo demás sale de ellas.",
    chars: ["n", "o"],
  },
  {
    title: "La familia de la n",
    text: "Reutilizan su asta y su arco: la h es una n con ascendente, la m tiene dos arcos, la u es una n girada y la r, un trozo de n.",
    chars: ["h", "m", "u", "r"],
  },
  {
    title: "Asta y panza: n + o",
    text: "Combinan un asta recta con la panza de la o.",
    chars: ["b", "d", "p", "q"],
  },
  {
    title: "Redondas abiertas",
    text: "Salen de la o, con aberturas. La a, la s y la g son de las más difíciles: dales tiempo.",
    chars: ["c", "e", "s", "a", "g"],
  },
  {
    title: "Diagonales",
    text: "Comparten ángulos y grosores entre ellas; dibújalas juntas.",
    chars: ["v", "w", "x", "y", "k", "z"],
  },
  {
    title: "Las demás minúsculas",
    text: "Astas simples (i l j) y las de travesaño (f t).",
    chars: ["i", "l", "j", "f", "t"],
  },
  {
    title: "Mayúsculas de control: H y O",
    text: "La H fija el grosor y la altura de las mayúsculas; la O, sus curvas. Suelen ser algo más gruesas y anchas que las minúsculas.",
    chars: ["H", "O"],
  },
  {
    title: "Rectas: I L F E T",
    text: "Salen de las astas y la barra de la H.",
    chars: ["I", "L", "F", "E", "T"],
  },
  {
    title: "Redondas",
    text: "Salen de la O.",
    chars: ["C", "D", "G", "Q"],
  },
  {
    title: "Diagonales",
    text: "Comparten ángulos y grosores; la M y la N mezclan astas y diagonales.",
    chars: ["A", "V", "W", "X", "Y", "K", "M", "N", "Z"],
  },
  {
    title: "Mixtas",
    text: "Combinan rectas y curvas: la B, la P y la R comparten su panza.",
    chars: ["B", "P", "R", "S", "J", "U"],
  },
  {
    title: "Números",
    text: "Primero el 0 y el 1, que fijan su ancho y altura; el resto se apoya en ellos.",
    chars: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
  },
  {
    title: "Puntuación",
    text: "El punto fija el tamaño de los demás signos: la coma, los dos puntos, la exclamación…",
    chars: [".", ",", ":", ";", "!", "?", "-", "'", "\"", "(", ")"],
  },
];

// The first letter of the order that isn't drawn yet, or null.
export function nextToDraw(font, isEmpty) {
  for (const step of ORDER) {
    for (const char of step.chars) if (font.glyphs[char] && isEmpty(font.glyphs[char])) return char;
  }
  return null;
}

const $ = (id) => document.getElementById(id);

// Wires the "¿Por dónde empiezo?" button and its dialog. `getFont()` gives
// the open font; `isEmptyGlyph` tells drawn letters apart; `selectGlyph`
// opens a letter.
export function initGuide({ getFont, isEmptyGlyph, selectGlyph }) {
  const dialog = $("guideDialog");
  const open = (char) => {
    dialog.close();
    selectGlyph(char);
  };

  function render() {
    const font = getFont();
    const next = nextToDraw(font, isEmptyGlyph);
    const nextBtn = $("guideNext");
    nextBtn.hidden = !next;
    if (next) nextBtn.textContent = `Siguiente sugerida: «${next}»`;
    $("guideDone").hidden = !!next;
    const list = $("guideSteps");
    list.replaceChildren(...ORDER.map((step) => {
      const li = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = step.title;
      const text = document.createElement("p");
      text.textContent = step.text;
      const chars = document.createElement("div");
      chars.className = "guide-chars";
      for (const char of step.chars) {
        const g = font.glyphs[char];
        if (!g) continue;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "guide-char";
        b.textContent = char;
        const drawn = !isEmptyGlyph(g);
        b.classList.toggle("drawn", drawn);
        b.classList.toggle("next", char === next);
        b.title = `${drawn ? "Dibujada" : "Sin dibujar"} · abrir «${char}»`;
        b.addEventListener("click", () => open(char));
        chars.appendChild(b);
      }
      li.append(title, text, chars);
      return li;
    }));
  }

  $("guideBtn").addEventListener("click", () => {
    render();
    dialog.showModal();
  });
  $("guideNext").addEventListener("click", () => {
    const next = nextToDraw(getFont(), isEmptyGlyph);
    if (next) open(next);
  });
}
