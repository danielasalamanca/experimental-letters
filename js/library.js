// "Mis tipografías": several fonts saved in the browser.
//
// The index (which fonts exist and which one is open) and each font live in
// separate localStorage keys, so saving the open font only rewrites that
// font. `storage` is localStorage in the page and a stand-in in tests; every
// access is wrapped because storage can be unavailable or full.

const INDEX_KEY = "experimental-letters:library";
const FONT_PREFIX = "experimental-letters:font:";
const OLD_KEYS = ["experimental-letters:v2", "experimental-letters"]; // single-font versions

export const fontName = (font) =>
  [font.meta?.family, font.meta?.style].filter((s) => s && s.trim()).join(" ") || "Sin nombre";

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function read(storage, k) {
  try {
    const raw = storage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Returns { index, data }: the library index and the raw data of the open
// font (null when there is none yet). Projects saved by earlier versions
// become the first font of the library.
export function openLibrary(storage) {
  let index = read(storage, INDEX_KEY);
  if (index?.fonts && index.active && read(storage, FONT_PREFIX + index.active)) {
    return { index, data: read(storage, FONT_PREFIX + index.active) };
  }
  const old = OLD_KEYS.map((k) => read(storage, k)).find(Boolean) ?? null;
  index = { active: newId(), fonts: [] };
  return { index, data: old };
}

// Saves `font` as the open font. Returns false if the browser refused
// (e.g. storage full), so the caller can warn.
export function saveFont(storage, index, font) {
  const entry = { id: index.active, name: fontName(font), updated: Date.now() };
  index.fonts = [entry, ...index.fonts.filter((f) => f.id !== index.active)];
  try {
    storage.setItem(FONT_PREFIX + index.active, JSON.stringify(font));
    storage.setItem(INDEX_KEY, JSON.stringify(index));
    return true;
  } catch {
    return false;
  }
}

export const loadFont = (storage, id) => read(storage, FONT_PREFIX + id);

export function deleteFont(storage, index, id) {
  index.fonts = index.fonts.filter((f) => f.id !== id);
  try {
    storage.removeItem(FONT_PREFIX + id);
    storage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {}
}
