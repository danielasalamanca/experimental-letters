// Character set of the font: groups shown in the character map, glyph
// names (used for file names and, later, the .otf) and default sizes.

const range = (from, to) => {
  const out = [];
  for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) out.push(String.fromCharCode(c));
  return out;
};

export const ACUTE = "´"; // ´
export const TILDE = "˜"; // ˜
export const DIERESIS = "¨"; // ¨

// Case marks: the accents of the capitals ("´.case"…), like Glyphs'
// acute.case. They start as the lowercase accent raised to the capitals and
// can be drawn flatter or lower. No code point: only the accented capitals
// use them, as components.
const CASE = /^(.+)\.case$/su;
export const caseOf = (key) => CASE.exec(key)?.[1] ?? null;
export const caseKey = (mark) => `${mark}.case`;
export const CASE_MARKS = [ACUTE, TILDE, DIERESIS].map(caseKey);

export const GROUPS = [
  { name: "Mayúsculas", chars: [...range("A", "Z"), "Ñ"] },
  { name: "Minúsculas", chars: [...range("a", "z"), "ñ"] },
  { name: "Acentuadas", chars: ["á", "é", "í", "ó", "ú", "ü", "Á", "É", "Í", "Ó", "Ú", "Ü"] },
  { name: "Números", chars: range("0", "9") },
  { name: "Puntuación", chars: [".", ",", ";", ":", "!", "¡", "?", "¿", "-", "–", "—", "'", "\"", "‘", "’", "“", "”", "«", "»", "(", ")", "/"] },
  { name: "Símbolos", chars: ["&", "@", "#", "%", "$", "€"] },
  { name: "Acentos (componentes)", chars: [ACUTE, TILDE, DIERESIS, ...CASE_MARKS] },
  { name: "Espacio", chars: [" "] },
];

export const CHARSET = GROUPS.flatMap((g) => g.chars);

const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

const NAMES = {
  ".": "period", ",": "comma", ";": "semicolon", ":": "colon", "!": "exclam",
  "?": "question", "¡": "exclamdown", "¿": "questiondown",
  "-": "hyphen", "–": "endash", "—": "emdash", "'": "quotesingle", "\"": "quotedbl",
  "‘": "quoteleft", "’": "quoteright", "“": "quotedblleft", "”": "quotedblright",
  "«": "guillemetleft", "»": "guillemetright", "/": "slash",
  "&": "ampersand", "@": "at", "#": "numbersign", "%": "percent", "$": "dollar", "€": "Euro",
  "(": "parenleft", ")": "parenright", " ": "space",
  [ACUTE]: "acute", [TILDE]: "tilde", [DIERESIS]: "dieresis",
  "á": "aacute", "é": "eacute", "í": "iacute", "ó": "oacute", "ú": "uacute", "ü": "udieresis",
  "Á": "Aacute", "É": "Eacute", "Í": "Iacute", "Ó": "Oacute", "Ú": "Uacute", "Ü": "Udieresis",
  "ñ": "ntilde", "Ñ": "Ntilde",
};

// Alternates: other versions of a character, kept as "a.alt1", "a.alt2"…
// They have no code point of their own; the .otf offers them as
// alternates of their character (see otf.js, gsubAlternates).
const ALT = /^(.+)\.alt(\d+)$/su;
export const alternateOf = (key) => {
  const m = ALT.exec(key);
  return m ? { base: m[1], n: +m[2] } : null;
};
export const alternateKey = (base, n) => `${base}.alt${n}`;
// The character a glyph stands for (its own, the one it is an alternate of,
// or the accent of a case mark).
export const baseChar = (key) => alternateOf(key)?.base ?? caseOf(key) ?? key;

export function glyphName(char) {
  const alt = alternateOf(char);
  if (alt) return `${glyphName(alt.base)}.alt${alt.n}`;
  const mark = caseOf(char);
  if (mark) return `${glyphName(mark)}.case`;
  if (NAMES[char]) return NAMES[char];
  if (/[0-9]/.test(char)) return DIGITS[+char];
  return char;
}

// Safe file name: avoids "a.svg" and "A.svg" clashing on macOS.
export function fileName(char) {
  const name = glyphName(char);
  return /^[A-Z]/.test(name) ? `${name}-mayus` : name;
}

export const codepoint = (char) => caseOf(char) ? "sin código"
  : "U+" + baseChar(char).codePointAt(0).toString(16).toUpperCase().padStart(4, "0");

// Accented letters start as composites: base letter + accent glyph.
// Capitals use the case marks, already at the cap height.
export const COMPOSITES = {
  "á": ["a", ACUTE], "é": ["e", ACUTE], "í": ["i", ACUTE],
  "ó": ["o", ACUTE], "ú": ["u", ACUTE], "ü": ["u", DIERESIS], "ñ": ["n", TILDE], "Ñ": ["N", caseKey(TILDE)],
  "Á": ["A", caseKey(ACUTE)], "É": ["E", caseKey(ACUTE)], "Í": ["I", caseKey(ACUTE)], "Ó": ["O", caseKey(ACUTE)],
  "Ú": ["U", caseKey(ACUTE)], "Ü": ["U", caseKey(DIERESIS)],
};

export const INVERTED_PUNCTUATION = { "¡": "!", "¿": "?" };

// Capitals (and digits, and case marks) are drawn up to the cap height; this
// also covers accented capitals like "Á", which /[A-Z]/ alone would miss.
export const isCapital = (key) => {
  if (caseOf(key)) return true;
  const char = baseChar(key);
  return /[0-9]/.test(char) || (char !== char.toLowerCase() && char === char.toUpperCase());
};

export function defaultCols(key) {
  const char = baseChar(key);
  if (char === " ") return 5;
  if (char === ACUTE || char === TILDE || char === DIERESIS) return 4;
  if ("()/".includes(char)) return 4;
  if (char === "-") return 5;
  if (char === "–") return 6;
  if (char === "—") return 12;
  if ("“”«»".includes(char)) return 4;
  if (".,;:!¡'\"‘’".includes(char)) return 2;
  if (char === "%") return 10;
  if (char === "?" || char === "¿") return 6;
  if ("iíjl".includes(char)) return 3;
  return 8;
}
