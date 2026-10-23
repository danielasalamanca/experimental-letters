// Undo history (pure, no DOM). Each step is a snapshot of the whole font,
// but a glyph that didn't change since the previous snapshot reuses that
// snapshot's JSON string instead of keeping a copy of its own. A drawn font
// with its bold masters is ~2 MB of JSON, so whole copies at every step
// added up to hundreds of MB; now a step costs about what it changed.

// The font as { rest, glyphs }: JSON of everything but the glyphs, and the
// JSON of each glyph, shared with `previous` where it is the same.
export function snapshot(font, previous = null) {
  const glyphs = {};
  for (const [k, g] of Object.entries(font.glyphs)) {
    const json = JSON.stringify(g);
    const before = previous?.glyphs[k];
    glyphs[k] = before === json ? before : json;
  }
  const { glyphs: _, ...rest } = font;
  return { rest: JSON.stringify(rest), glyphs };
}

// The plain font data a snapshot was taken from.
export function fromSnapshot(snap) {
  const data = JSON.parse(snap.rest);
  data.glyphs = Object.fromEntries(Object.entries(snap.glyphs).map(([k, json]) => [k, JSON.parse(json)]));
  return data;
}

export class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.last = null; // the latest snapshot, to share glyphs with
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  // Before a change: remembers the font as it is now.
  push(font) {
    this.last = snapshot(font, this.last);
    this.undoStack.push(this.last);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  // The font data to go back (or forward) to, or null; `font` is the
  // current font, kept to come back to it.
  undo(font) { return this.#move(this.undoStack, this.redoStack, font); }
  redo(font) { return this.#move(this.redoStack, this.undoStack, font); }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.last = null;
  }

  #move(from, to, font) {
    const snap = from.pop();
    if (!snap) return null;
    this.last = snapshot(font, snap);
    to.push(this.last);
    return fromSnapshot(snap);
  }
}
