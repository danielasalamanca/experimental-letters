// The final outline of a glyph, in cells (y up, x from the drawing's first
// column): its grid drawing (stars or squares, with corners and pieces) plus
// any node-edited outlines. Used by the .otf export and to turn a glyph
// into an editable outline.

import { glyphContours } from "./outline.js";
import { squareGlyphContours, roundedContours, contoursWithPieces } from "./pieces.js";
import { outlineToCommands } from "./nodes.js";
import { resolvedCells, glyphShape } from "./model.js";
import { parseKey } from "./geometry.js";

// mode: "join" = with the minimum join (as on the canvas), "raw" = as is.
export function glyphFinalContours(font, glyph, options = {}) {
  const shape = glyphShape(font, glyph);
  const raw = glyphRawContours(font, glyph, options);
  if (!shape.outline.length) return raw;
  // Node outlines: merged with the rest, with live rounded corners on top.
  return roundedContours(raw, { rounding: shape.rounding, corners: shape.corners });
}

// The grid drawing (already rounded) plus the node outlines as they are.
// `sharp`: the corners pieces make on the circle grid left unrounded (for
// the corner tool, which rounds them itself).
export function glyphRawContours(font, glyph, { mode = "join", sharp = false } = {}) {
  const cu = font.cell;
  const cells = resolvedCells(font, glyph).filter((k) => {
    const [c] = parseKey(k);
    return c >= 0 && c < glyph.cols;
  });
  const shape = glyphShape(font, glyph);
  const joinWidth = mode === "join" && font.join.enabled ? font.join.width / cu : 0;
  // Pieces are drawn on either grid, even on a letter without cells.
  const contours = !cells.length && !shape.pieces.length ? [] : shape.grid === "squares"
    ? squareGlyphContours(cells, {
      rounding: shape.rounding, corners: shape.corners, pieces: shape.pieces,
      stroke: font.style === "outline" ? font.stroke / cu : 0,
    })
    : shape.pieces.length
      ? contoursWithPieces(glyphContours(cells, { curve: shape.curve, joinWidth }), shape.pieces, { corners: sharp ? {} : shape.corners })
      : glyphContours(cells, { curve: shape.curve, joinWidth });
  return [...contours, ...outlineToCommands(shape.outline)];
}

// The glyph's own shape, without components: what "Editar con nodos" turns
// into nodes.
export const ownContours = (font, glyph) =>
  glyphFinalContours(font, { ...glyph, components: [] });
