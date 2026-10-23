# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A web editor for designing typefaces on modular grids ("Experimental Letters"), published on GitHub Pages. Static site, no build step: `index.html`, `style.css` and native ES modules in `js/`. The UI, README, toasts and commit messages are in Spanish; code comments and identifiers are in English.

## Commands

```bash
python3 -m http.server 8123          # serve the editor (also the "letras" entry in .claude/launch.json)
npm test                              # all tests (node --test, no dependencies)
node --test tests/pieces.test.js      # one file
node --test --test-name-pattern="dots and slits" tests/pieces.test.js   # one test
```

There is no linter or bundler. On every release, bump the `?v=` number in `index.html` (stylesheet, import map and script) so browsers don't mix cached and new modules. Every module in `js/` must be listed in the import map: one that isn't keeps loading without `?v=` and browsers can serve a stale copy (this happened with `masters.js` and `variable.js`).

When checking changes in the browser, prefer `http://127.0.0.1:8123` over `localhost`: it's a separate origin with its own localStorage, so the user's saved fonts aren't touched.

## Architecture

**Coordinates.** Drawings are in *cells* (y up, baseline at row 0, x from the drawing's first column). Font units = cells × `font.cell` (default 50, UPM 1000). SVG rendering negates y. Vertical metrics are stored as whole rows.

**Glyph model (`js/model.js`, pure, no DOM).** A glyph has `cells` (keys `"c,r"`), `cols`, sidebearings, optional per-glyph `grid`/`curve`/`rounding`, `corners` (radius per lattice/corner key), `pieces`, `components` (other glyphs reused with a dx/dy offset, e.g. á = a + ´), an optional `outline` (node-edited contours that *replace* its grid drawing), and `bold` (the second master). `glyphShape(font, glyph)` resolves everything needed to draw it, including components' cells/corners/pieces (`resolved*` functions).

**Glyph keys (`js/charset.js`).** Most keys are one character. Others: alternates `"a.alt1"` (no code point, exported as alternates in GSUB; they share their letter's sidebearings and kerning) and case marks `"´.case"` (accents of the capitals, no code point). `baseChar`, `alternateOf` and `caseOf` tell them apart. Fonts carry a format `version` (`model.js` `VERSION`); `normalizeFont` migrates older ones.

**Kerning.** Pairs in `font.kerning` (`"AV": -40`) plus Glyphs-style groups: `font.groups.left/right` name each glyph's group per side (accented letters and alternates inherit their letter's), and `font.groupKerning[rightGroup][leftGroup]` holds group values. A pair of its own is an exception (even at 0). Export expands everything into glyph pairs (`kerningPairs`). With `font.allCaps`, lowercase letters are set and exported as their capitals (`capitalOf`).

**Two grids, one drawing.** The same cells render as either:
- *circles* — each cell is a concave star between four circles (`geometry.js`); exact export outlines built analytically in `outline.js` (`glyphContours`), with optional "unión mínima" bridges.
- *squares* — rounded squares (`outline.js` `squareContours`), with global and per-corner rounding.

**Pieces and booleans (`js/pieces.js`).** Pieces (triangle, quarter ellipse, spandrel, polygon, ellipse, capsule) add or cut ink on top of the cells, in order, on either grid. Booleans use Clipper (`js/vendor/clipper.js`) on finely flattened outlines; a `CurveBook` remembers which Bézier each sample came from and `refit` turns runs back into exact curves, so exported fonts keep real curves. On squares, corner rounding is applied *after* pieces (`roundCorners`). The same machinery powers node-outline live rounding, `unionContours` and the Illustrator-style pathfinder.

**One pipeline for every output.** `render.js` `drawShapes` (canvas, thumbnails, test text) and `shapes.js` `glyphFinalContours` (export, "Editar con nodos", masters) must produce the same ink — when changing how a glyph is drawn, change both.

**Nodes (`js/nodes.js`).** Converts contours ⇄ editable outlines (`{ closed, nodes: [{ x, y, in, out }] }`, handles relative). Once a glyph has an `outline`, grid tools (Dibujar, Seleccionar) are disabled for it; Piezas/Polígono then join their figure into the outline via the pathfinder instead of creating pieces.

**Masters (`js/masters.js`, `js/variable.js`).** `glyph.bold` is a full glyph of its own; while `auto` it's the Regular thickened (`makeBold`: `axis.thicken` on vertical strokes, `axis.contrast` times that on horizontal ones, and points on the metric lines keep their height). An automatic master is remade when its `source` (the Regular's drawing plus those settings) changes. Interpolation needs compatible contours (same points, same order), which masters.js enforces. `variable.js` writes a TrueType variable font (glyf + gvar + fvar) by hand; `otf.js` builds CFF .otf with opentype.js (`js/vendor/`) and writes the GPOS kerning table itself; `woff.js` wraps either as WOFF 1.0 (zlib; WOFF2 would need Brotli, which browsers can't compress with).

**Editor (`js/main.js`).** The main module holds UI state (`font`, current `tool`, `action` for the drag in progress, selections) and wires the panels, tools and keyboard shortcuts. Pointer handling is a single `pointerdown`/move/up flow dispatching on `tool` and `action.type`. `checkpoint()` before any change makes it undoable; `history.js` keeps the snapshots, sharing unchanged glyphs' JSON between steps. Fonts persist in localStorage via `library.js`.

Parts of the UI live in their own modules, which get what they need from main.js through an `init…({ getFont, … })` call instead of reading its variables: `export.js` (font files and SVG/PNG images), `testbar.js` (test text and kerning) and `guide.js` ("¿Por dónde empiezo?"). New UI pieces should follow that pattern.

**Tests** cover the pure modules: geometry and exported outlines are checked against the intended shape at thousands of sample points (winding 0/1 only: no overlaps or reversed contours), and generated fonts are parsed back with opentype.js.
