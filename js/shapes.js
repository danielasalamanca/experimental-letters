// The final outline of a glyph, in cells (y up, x from the drawing's first
// column): its grid drawing (stars or squares, with corners and pieces) plus
// any node-edited outlines. Used by the .otf export and to turn a glyph
// into an editable outline.

import { glyphContours } from "./outline.js";
import { squareGlyphContours, unionContours } from "./pieces.js";
import { outlineToCommands } from "./nodes.js";
import { resolvedCells, glyphShape } from "./model.js";
import { parseKey } from "./geometry.js";

// mode: "join" = with the minimum join (as on the canvas), "raw" = as is.
export function glyphFinalContours(font, glyph, { mode = "join" } = {}) {
  const cu = font.cell;
  const cells = resolvedCells(font, glyph).filter((k) => {
    const [c] = parseKey(k);
    return c >= 0 && c < glyph.cols;
  });
  const shape = glyphShape(font, glyph);
  const joinWidth = mode === "join" && font.join.enabled ? font.join.width / cu : 0;
  const contours = !cells.length ? [] : shape.grid === "squares"
    ? squareGlyphContours(cells, {
      rounding: shape.rounding, corners: shape.corners, pieces: shape.pieces,
      stroke: font.style === "outline" ? font.stroke / cu : 0,
    })
    : glyphContours(cells, { curve: shape.curve, joinWidth });
  if (!shape.outline.length) return contours;
  // Hand-edited outlines may overlap the rest: merge everything.
  return unionContours([...contours, ...outlineToCommands(shape.outline)]);
}

// The glyph's own shape, without components: what "Editar con nodos" turns
// into nodes.
export const ownContours = (font, glyph) =>
  glyphFinalContours(font, { ...glyph, components: [] });
