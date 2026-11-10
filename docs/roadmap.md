# Roadmap

Status as of the 1.0.0 release. Every shipped item below is backed by an entry in
[`docs/audit.md`](./audit.md) with `file:line` evidence and the checks that were
run for it.

## Shipped

### Foundation

- Canonical `DesignDoc` in `packages/core`: parser, validator, serializer and
  scoped merge, with resource limits enforced in the owning layer.
- Arabic-first editor: fully bilingual `ar`/`en` UI, RTL-aware layout, Arabic
  font groups and the zero-letter-spacing invariant for Arabic text.
- Local-first storage with revision checks, recovery from a corrupt record,
  bounded undo/redo and pre-AI snapshots.

### Canvas and editing

- Direct manipulation: mouse, touch and pen selection, marquee, Shift add,
  Space-drag pan, wheel pan, pixel-grid snapping and smart alignment guides.
- A single unclipped `.artboard-overlays` layer for selection chrome, transform
  HUD, equal-spacing badges, rulers, safe-margin and bleed guides — so handles
  stay reachable at the artboard edge.
- Six text handles, eight handles for other layers, corner font scaling, edge
  reflow, Alt-drag duplication and bracket reordering.
- Quick insert keys (`t`, `r`, `c`, `l`), a 48px contextual ribbon, a floating
  layer bar and a right-click layer menu, all inside the overlay contract.

### Documents and design system

- File and Resize menus, including anchored Canva-style magic resize: full-bleed
  backdrops stretch, other layers keep 9-zone anchors, wide text rewraps inside a
  7% safe margin, dividers stretch on one axis and radii scale uniformly.
- Seven text effects. Echo, Splice and Glitch use locked `__fx1`/`__fx2`
  companion layers, so no schema change was needed.
- Format painter, document colour extraction, colour replacement across the
  document with one undo step, alpha, swatches and gradient presets.
- A viewport-fitting preview modal (zoom, backdrops, fullscreen, Escape) and an
  export dialog with a portable filename, presets, clipboard copy and a receipt.

### Export and quality

- PNG, JPEG, PDF and standalone HTML exports from one renderer, with megapixel
  and byte limits, an idempotency key per request and an export cache.
- A custom launcher with a strict CSP, MIME and asset limits, and a test suite
  covering unit, contract, server, browser and reviewed visual goldens.

## Known gaps at 1.0.0

- **Element library:** 14 of the planned 26 kinds ship. The remaining twelve need
  the plan's enumerated list; the six added in this cycle are triangle, diamond,
  hexagon, cross, plus and heart.
- **Template palette application:** `applyTemplatePalette` through
  `mergeDesignDoc` is not implemented yet.
- **Drag-and-drop uploads:** files can be added from the rail picker, not by
  dropping them on the canvas.
- **Two-column export layout:** attempted and reverted because it made the 1×
  scale control unclickable in Playwright; export is single-column.
- **Clipboard copy:** implemented, but not covered by an automated test because
  the browser test context does not grant clipboard-write.
- **i18n module split:** labels live in one `i18n.ts` rather than the planned
  `i18n/{types,core,toolbar,rail,modals,index}.ts` modules.

## After 1.0.0

1. Finish the element catalogue and add drag-and-drop uploads with the existing
   MIME and size guards.
2. Add template palettes: derive a five-colour palette from a template and map
   the current document's roles onto it through the core merge.
3. Split the i18n dictionary by surface and add a coverage test that fails when a
   label exists in one language only.
4. Accessibility pass: focus traps for every modal, visible focus rings on the
   canvas, and a keyboard path for layer ordering.
5. Deployment hardening: container isolation, TLS, real auth integration and an
   external security review before any public hosting.
