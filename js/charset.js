// Character set of the font: groups shown in the character map, glyph
// names (used for file names and, later, the .otf) and default sizes.

const range = (from, to) => {
  const out = [];
  for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) out.push(String.fromCharCode(c));
  return out;
};

export const ACUTE = "´"; // ´
export const TILDE = "˜"; // ˜

export const GROUPS = [
  { name: "Mayúsculas", chars: [...range("A", "Z"), "Ñ"] },
  { name: "Minúsculas", chars: [...range("a", "z"), "ñ"] },
  { name: "Acentuadas", chars: ["á", "é", "í", "ó", "ú", "Á", "É", "Í", "Ó", "Ú"] },
  { name: "Números", chars: range("0", "9") },
  { name: "Puntuación", chars: [".", ",", ";", ":", "!", "?", "-", "'", "\"", "(", ")"] },
  { name: "Acentos (componentes)", chars: [ACUTE, TILDE] },
  { name: "Espacio", chars: [" "] },
];

export const CHARSET = GROUPS.flatMap((g) => g.chars);

const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

const NAMES = {
  ".": "period", ",": "comma", ";": "semicolon", ":": "colon", "!": "exclam",
  "?": "question", "-": "hyphen", "'": "quotesingle", "\"": "quotedbl",
  "(": "parenleft", ")": "parenright", " ": "space",
  [ACUTE]: "acute", [TILDE]: "tilde",
  "á": "aacute", "é": "eacute", "í": "iacute", "ó": "oacute", "ú": "uacute",
  "Á": "Aacute", "É": "Eacute", "Í": "Iacute", "Ó": "Oacute", "Ú": "Uacute",
  "ñ": "ntilde", "Ñ": "Ntilde",
};

export function glyphName(char) {
  if (NAMES[char]) return NAMES[char];
  if (/[0-9]/.test(char)) return DIGITS[+char];
  return char;
}

// Safe file name: avoids "a.svg" and "A.svg" clashing on macOS.
export function fileName(char) {
  const name = glyphName(char);
  return /^[A-Z]/.test(name) ? `${name}-mayus` : name;
}

export const codepoint = (char) =>
  "U+" + char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");

// Accented letters start as composites: base letter + accent glyph.
// dy is in rows: capitals need the accent lifted to the cap height.
export const COMPOSITES = {
  "á": ["a", ACUTE], "é": ["e", ACUTE], "í": ["i", ACUTE],
  "ó": ["o", ACUTE], "ú": ["u", ACUTE], "ñ": ["n", TILDE], "Ñ": ["N", TILDE],
  "Á": ["A", ACUTE], "É": ["E", ACUTE], "Í": ["I", ACUTE], "Ó": ["O", ACUTE], "Ú": ["U", ACUTE],
};

// Capitals (and digits) are drawn up to the cap height; this also covers
// accented capitals like "Á", which /[A-Z]/ alone would miss.
export const isCapital = (char) => /[0-9]/.test(char) || (char !== char.toLowerCase() && char === char.toUpperCase());

export function defaultCols(char) {
  if (char === " ") return 5;
  if (char === ACUTE || char === TILDE) return 4;
  if ("()".includes(char)) return 4;
  if (char === "-") return 5;
  if (".,;:!'\"".includes(char)) return 2;
  if (char === "?") return 6;
  if ("iíjl".includes(char)) return 3;
  return 8;
}
