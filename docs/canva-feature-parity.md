# Canva feature parity — clean-room inventory and roadmap

- **Status:** Living document
- **Last updated:** 2026-11-07
- **Method:** Passive observation of public Canva pages with REA 6.8.0
  (`rea capture-browser-scenario`), plus our own product decisions.
- **Constraint:** No Canva code, CSS, templates, images, icons, fonts, copy, or
  trademarks are copied into this repository. See
  `docs/adr/0001-clean-room-canva-parity.md`.

## 1. What we observed

The observations are behavior inventories, not design specifications to copy.
Raw captures stay local and are excluded from git; evidence IDs are listed in
the ADR.

### 1.1 Public poster funnel

The poster landing and product pages show:

- a hero prompt to start designing, upload from device, or create a poster;
- poster templates and category browsing;
- format/aspect-ratio selection (portrait 3:4 in the observed page);
- physical size selection (small/medium/large/extra large), size guide;
- frame selection (black/white/woodgrain/none);
- paper/finish selection (fine art/gloss/mounted);
- quantity and live price;
- print fulfillment, delivery, happiness guarantee, proofing;
- brand kit and design-resize messaging on the marketing page.

These are **product capabilities**, not UI to replicate pixel-for-pixel. Our
first release is a digital poster editor and exporter; print fulfillment is out
of scope until a print partner is selected.

### 1.2 Editor shell

Observed public editor structure (after closing the login dialog, without
authenticating):

- document menubar: Home, File;
- File menu: create new design, rulers and guides, save, download, print,
  settings, accessibility, find and replace, help;
- share/publish area: print, share, sign in;
- left side panel tabs: Templates, Elements, Text, Uploads, Tools, Apps;
- canvas with page controls (lock page, duplicate page, add page), page
  thumbnails, zoom slider/options, pages count, grid view, present full screen,
  notes, timer, help;
- selection model with move, eight resize handles, rotate, lock, and a
  contextual toolbar;
- undo/redo and an unsaved-changes indicator.

### 1.3 Text

- add a text box;
- default styles: heading, subheading, body;
- brand fonts entry point;
- dynamic text (page numbers);
- font search and font combinations;
- text effects;
- contextual text toolbar: font family, font size (decrease/increase and
  numeric), color, bold, italic, underline, strikethrough, alignment, lists,
  spacing, transparency, effects, animate, position, more.

### 1.4 Elements

Observed categories: shapes, graphics, animations, photos, videos, audio,
charts, sheets, tables, frames, grids, 3D. Our poster scope prioritizes shapes,
graphics/SVG, photos, frames, grids, and tables; video/audio/3D are later.

### 1.5 Tools and uploads

- Tools: select, draw, shapes, lines, sticky notes, text, signature, tables.
- Uploads: upload from device, record yourself.
- Apps: third-party integrations (out of scope for the first release).

### 1.6 AI and export

- AI capabilities surfaced on public pages include image editing, erasing,
  subject selection, text generation, translation, image generation, and
  design resizing. These are reference capabilities; we do not use Canva's
  models or prompts.
- Download panel: file type (PNG suggested), size, quality (compress/high/limit
  size), transparent background, download; print-with-Canva cross-sell.

## 2. Our product scope

### 2.1 Core promise

An Arabic-first AI poster editor where the **Design HTML document is the single
source of truth**. A user can:

1. start from a prompt, a blank poster, or one of our templates;
2. edit text, shapes, images, and SVG layers on a canvas;
3. ask AI to generate or revise a selection;
4. export a deterministic PNG/JPEG/PDF;
5. save and reopen the project without losing fidelity.

### 2.2 Non-goals for the first release

- pixel-identical Canva UI or keyboard shortcuts;
- Canva's template marketplace, stock library, brand assets, or fonts;
- print fulfillment and physical product ordering;
- real-time multiplayer, comments, and presence;
- third-party app marketplace;
- video/audio editing, 3D, animation timeline;
- Canva's proprietary AI models or model names;
- training any model on Canva content.

## 3. Feature matrix

Status: **Done** = implemented and tested in this repository; **Next** = M1;
**Later** = M2/M3; **Out** = deliberate non-goal.

| Capability | Observed reference behavior | Our implementation | Status | Milestone |
| --- | --- | --- | --- | --- |
| Design document | Canvas with artboard, pages, zoom | `DesignDoc` + strict Design HTML parser/serializer; single artboard first | Done (single page) | M0 |
| Canonical round trip | Not observable | `parse -> canonicalize -> serialize` byte-stable, property-tested | Done | M0 |
| Security boundary | Not observable | parse5 whitelist, CSS/SVG allow-lists, `asset:` scheme, size/layer limits | Done | M0 |
| AI merge contract | Not observable | selection-scoped three-way merge with warnings | Done | M0 |
| Editor shell | Menubar, left rail, canvas, contextual toolbar, footer | React shell: top bar, left rail, canvas, right inspector, footer | Next | M1 |
| Layers | Add/select/move/resize/rotate/lock/hide/reorder | Pointer transforms, z-order, lock/hide, duplicate/delete | Next | M1 |
| Text | Add text, styles, font search, combos, effects | Text layer editing, 11 fonts, RTL/LTR, bold/italic/underline, align, spacing, shadow | Next | M1 |
| Shapes | Shapes, lines, frames, grids | Rect/ellipse/line via shape layer; SVG for icons; frames/grids later | Next | M1/M2 |
| Images | Upload, place, crop/fit | Asset upload, `object-fit`/position, radius/border/shadow | Next | M1 |
| SVG | Graphics/elements | Allow-listed SVG tree, local gradient refs only | Done (engine) | M0 |
| Templates | Template gallery, categories, search | Our own JSON/Design HTML templates + category metadata | Next | M2 |
| AI generate | Prompt to design | Provider abstraction, prompt -> Design HTML, validation, repair loop | Next | M1 |
| AI edit | Selection-aware revisions | Instruction + selected layer IDs -> patch -> merge | Next | M1 |
| AI image | Text-to-image, edit, erase | Provider-gated, budget-capped; store prompt + asset metadata | Later | M2 |
| AI text tools | Write, translate | Rewrite/translate selected text; no external assets | Later | M2 |
| Fonts | Large font library, brand fonts | 11 self-hosted OFL fonts; brand kit later | Done (fonts) | M0 |
| Undo/redo | Document history | Command history, max 100 steps | Next | M1 |
| Save/load | Autosave, version history | Project JSON + Design HTML snapshots; autosave | Next | M1 |
| Export PNG/JPEG | Download panel, size/quality/transparent | Isolated Playwright worker, deterministic render, limits | Next | M1 |
| Export PDF | Print/download | Same worker, PDF path | Later | M2 |
| Zoom/grid/rulers | Zoom, grid view, rulers and guides | Zoom + grid; rulers later | Next | M1 |
| Pages | Multi-page documents | Single artboard first; page list later | Later | M3 |
| Present mode | Full-screen presentation | Optional later | Later | M3 |
| Brand kit | Colors, fonts, logos | Own brand presets | Later | M3 |
| Resize/magic switch | Resize design to formats | Deterministic layout reflow + template variants | Later | M3 |
| Collaboration | Multiplayer, comments | Out of scope first release | Out | — |
| Print fulfillment | Print with Canva | Partner integration later | Out | — |
| App marketplace | Third-party apps | Out of scope | Out | — |
| Video/audio/3D | Media editing | Out of scope | Out | — |

## 4. UX architecture mapping

Canva's public editor uses a familiar three-zone layout. We adopt the
convention, not the styling:

```
┌──────────────────────────────────────────────────────────────┐
│ Top bar: project name · undo/redo · save state · export/share │
├──────────────┬───────────────────────────────┬───────────────┤
│ Left rail    │ Canvas                        │ Inspector     │
│ Templates    │  ┌─────────────────────────┐  │ Transform     │
│ Elements     │  │ artboard                │  │ Fill/border   │
│ Text         │  │  layers                 │  │ Typography    │
│ Uploads      │  └─────────────────────────┘  │ Effects       │
│ Layers       │  zoom · grid · pages          │ AI actions    │
├──────────────┴───────────────────────────────┴───────────────┤
│ Status: selection · warnings · autosave · limits             │
└──────────────────────────────────────────────────────────────┘
```

Key interaction decisions:

- **Selection**: click to select, shift-click to add, drag to move, handles to
  resize, rotation handle, arrow keys to nudge, `Delete` to remove.
- **Inspector**: right-side panel for precise values; the canvas toolbar keeps
  the most-used text controls.
- **Layers**: bottom-up list matching paint order; drag to reorder; eye/lock
  toggles.
- **RTL**: text layers carry `dir`; Arabic content defaults to RTL; alignment
  `start`/`end` maps to the layer direction; letter-spacing warns on Arabic.
- **AI**: a prompt box and selection-scoped actions; every AI response is
  parsed, validated, canonicalized, and merged; invalid output never reaches
  the canvas.

## 5. Data model mapping

| Canva concept | Our model | Notes |
| --- | --- | --- |
| Design/page | `DesignDoc` (single artboard) | Pages later; `width`/`height` in px |
| Element | `Layer` union | `text`, `shape`, `image`, `svg` |
| Text box | `TextLayer` | `content` inline nodes, `style`, `dir` |
| Shape | `ShapeLayer` | solid/linear fill, border, radius, shadow |
| Image | `ImageLayer` | `asset:` src, fit/position, radius/border/shadow |
| Graphic/SVG | `SvgLayer` | strict tag/attribute allow-list, local refs only |
| Layer order | array order | later layers paint on top |
| Position/size | `left`, `top`, `width`, `height` | text height is automatic |
| Rotation | `rotation` degrees | normalized `[0, 360)` |
| Opacity | `opacity` 0..1 | canonical 2-decimal |
| Lock/hide | `locked`, `hidden` | editor state persisted in HTML |
| Download | export worker | PNG/JPEG/PDF, isolated process |
| Brand kit | later | colors/fonts/logos as presets |

## 6. AI scope decision

The spec review flagged image-generation scope as an unresolved product
decision. This document resolves it:

1. **M1 includes text-to-design and selection-scoped text edits.** These use a
   language model that returns Design HTML or a JSON patch. The server validates
   size, schema, allow-lists, and canonicalization before merging.
2. **M1 does not require image generation.** The editor supports uploaded
   images and `asset:` references. This keeps the first release shippable
   without a per-image cost or moderation pipeline.
3. **M2 adds image generation behind a provider interface.** Requirements:
   explicit user action, cost cap per project/day, content moderation, prompt
   and provenance stored on the asset, no training on user content without
   consent, and a deterministic fallback placeholder.
4. **AI never writes raw HTML into the live DOM.** It returns a document or
   patch that passes the same parser used for untrusted input.
5. **No Canva content is used as training data, prompts, few-shot examples, or
   style references.** Our prompts and templates are original.

## 7. Delivery plan

### M0 — Contract and safety (current)

- [x] TypeScript monorepo, pnpm workspaces.
- [x] Design HTML contract, canonicalization, parser, serializer.
- [x] Central limits and error/warning contracts.
- [x] Strict SVG and CSS allow-lists.
- [x] Selection-scoped merge.
- [x] Runtime schema validation.
- [x] Unit tests for round trip, security, limits, fonts, SVG, merge.
- [ ] CI, Docker, environment template, README (in progress).
- [x] REA clean-room observation and ADR.

### M1 — Usable editor

- [ ] React editor shell and canvas renderer.
- [ ] Selection, move, resize, rotate, z-order, lock/hide, duplicate/delete.
- [ ] Text editing and typography inspector.
- [ ] Shape and image inspectors.
- [ ] Undo/redo, autosave, project load/save.
- [ ] AI generate/edit endpoints with provider adapter and validation.
- [ ] PNG/JPEG export worker with limits and cache.
- [ ] E2E happy path and security regression suite.

### M2 — Content and AI expansion

- [ ] Template gallery with original templates.
- [ ] Asset uploads, image generation provider, moderation, cost caps.
- [ ] Font combinations, text effects, SVG icon library.
- [ ] PDF export and print-ready bleed/CMYK checks.

### M3 — Scale and differentiation

- [ ] Pages, grids/frames, tables, charts.
- [ ] Brand kit, resize variants, present mode.
- [ ] Version history and recovery.
- [ ] Collaboration only if the product validates the need.

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Accidental copying of Canva assets/code | ADR checklist, review gate, no captures in repo, original assets only |
| AI returns invalid or unsafe HTML | Strict parser, schema validation, canonicalization, repair loop, no direct DOM injection |
| Arabic text renders incorrectly | RTL inference, Arabic-capable font fallback, letter-spacing warning, golden tests |
| Export worker is a DoS vector | Queue, concurrency limit, pixel/time/byte limits, isolated process |
| Font licensing | OFL fonts only, license files shipped, no Canva Sans |
| Scope creep toward a full Canva clone | Feature matrix and non-goals above; ship the poster workflow first |
| Provider cost overrun | Per-project/day caps, usage accounting, image generation opt-in |

## 9. How to extend this document

When adding a parity feature:

1. describe the user capability in the matrix;
2. record whether it was observed publicly, inferred, or invented;
3. map it to the Design HTML model or explain why the model must change;
4. add security/limit tests before UI polish;
5. update the ADR checklist if the feature touches third-party rights.
