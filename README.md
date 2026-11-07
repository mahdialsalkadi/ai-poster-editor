# AI Poster Editor

An Arabic-first poster editor built around a strict **Design HTML** contract.
One canonical document is the source of truth for parsing, editing, AI patches
and export: the editor, the server and the model all speak the same restricted
language, and the invariants are enforced in `packages/core`.

## Status

**Milestones 1–5** are complete and gated. The shared core is the foundation:

- pnpm workspace with `packages/core`, `packages/contracts`, `apps/web` and
  `apps/server`;
- typed model, central limits, parse5 allow-list parser, css-tree style parser,
  canonical serializer, canonicalizer, zod runtime schema, `mergeDesignDoc` and
  `mergeScopedEdit`;
- security rejections are covered by tests: escaped CSS (`\75rl(`, `u\72l(`),
  mixed case (`URL(`), `@import`, `expression()`, `javascript:`,
  protocol-relative `//` URLs, remote SVG paint servers, and the full banned-tag
  corpus including `object`, `embed`, `meta`, `base`, `<use>` and
  `<foreignObject>`;
- fast-check property tests prove `parse(serialize(doc))` deep-equals the
  canonical document, plus byte-stable serialization and warning-free re-parsing;
- golden files for three sample designs (`packages/core/test/fixtures/golden`);
- a measured parse benchmark (see Tests).

`apps/web` now boots into a working editor shell. The canvas renders the
canonical document, and the layers panel, marquee-free selection, direct
manipulation (move, resize, rotate) and inline text entry all write back to the
same `DesignDoc`. Text is edited on canvas with a double click, `Enter` or `F2`,
committed with `Ctrl+Enter` or blur, and cancelled with `Escape`; the cap of
10,000 codepoints is enforced there too, and clearing a text field is treated as
a cancel rather than an invisible layer. The properties panel edits typography
(family, size, weight, spacing, alignment, direction, transform, italic,
underline, shadow, colour), fills, borders, corners, image fit and crop,
layer order, alignment and artboard size and background. Gestures are committed as a single undo step, arrow keys and
`Ctrl+Z`/`Ctrl+Shift+Z` are wired, and dragging snaps to artboard and layer
edges and centers with visible guide lines. Designs persist to `localStorage`
and can be imported from Design HTML.

AI runs through one OpenAI-compatible provider (`AI_PROVIDER`, `AI_MODEL`,
`AI_API_KEY`): generation returns canonical Design HTML, selection-scoped
editing merges a patch with `mergeScopedEdit` and snapshots the previous
document, invalid output is retried once with the validator error, and each
call reserves its worst-case cost against `AI_DAILY_SPEND_CAP_USD` before the
provider is contacted. With no provider configured the routes answer
`UNSUPPORTED_FEATURE`; `/api/export` lands in milestone 6.

## Requirements

- Node.js >= 22 (verified on 26.13.0)
- pnpm 12.16.1 (`npm i -g pnpm@12.16.1`)

pnpm 12 rejects packages younger than its minimum release age. `caniuse-lite`
publishes data-only updates daily, so it is exempted in `pnpm-workspace.yaml`;
every other dependency stays under the default policy.

## Quick start

```bash
pnpm install
pnpm --filter @poster/core test
pnpm -r typecheck
pnpm lint
```

Run the API (M0 surface only):

```bash
cp .env.example .env
pnpm --filter @poster/server dev
```

## Repository layout

```
packages/
  core/        Design HTML parser, serializer, canonicalizer, schema, merge
  contracts/   Shared API request/response and error envelopes
apps/
  web/         Vite + React editor shell (milestones 2–3)
  server/      Fastify API: AI generation and isolated export (milestones 5–6)
prompts/       System prompts for the Design HTML generator and editor
docs/          Design HTML contract and architecture decision records
```

## Design HTML

```html
<div class="artboard" data-width="1080px" data-height="1350px" style="background:#0f172a">
  <div
    data-id="headline"
    data-layer="Headline"
    data-type="text"
    dir="rtl"
    style="position:absolute;left:80px;top:120px;width:920px;font-family:'Cairo';font-size:96px;font-weight:700;color:#ffffff;text-align:right;line-height:1.25;letter-spacing:0px"
  >عنوان رئيسي</div>
</div>
```

```ts
import { parseDesignHtml, serializeDesignDoc } from '@poster/core';

const { doc, warnings } = parseDesignHtml(html);
const canonicalHtml = serializeDesignDoc(doc);
```

## Contract highlights

- **Canonical round trip:** `parse(serialize(doc))` deep-equals `doc` for
  canonical documents, and the second serialization is byte-identical.
- **Limits:** 200 KiB, 200 layers, 10k codepoints per text layer, 2k SVG nodes,
  40 MP exports. All limits live in `packages/core/src/limits.ts`.
- **Security:** parse5 + allow-lists; `asset:` image scheme; no scripts, event
  handlers, external references, or `innerHTML` of untrusted HTML.
- **Scoped AI merge:** only selected layers may change; missing selected layers
  are preserved; new layers are inserted above the highest selected layer;
  artboard size and background are immutable.
- **RTL:** Arabic text is inferred as RTL when `dir` is missing; Latin-only fonts
  fall back to Cairo; letter-spacing on Arabic is reported.

Full details: [`docs/contract.md`](docs/contract.md).

## Tests

`@poster/core` currently runs 151 tests across 10 files, including the golden
files, the security corpus, limits, untrusted-data wrapping and fast-check
properties.

Measured on the development machine with `pnpm --filter @poster/core test`
(`test/perf.test.ts`), parsing a 200-layer / 56.4 KiB document:

```
p50 = 18.61 ms   p95 = 56.59 ms   min = 13.34 ms   max = 109.42 ms
```

The spec's "1–3 ms" figure was not reproduced and should be treated as
unverified; the export path is not claimed to be pixel-identical to the editor
until the visual-regression tests in milestone 6 exist.

## Milestones

| Milestone | Scope | Status |
| --- | --- | --- |
| 1 | `packages/core` contract, parser, serializer, merge, tests | done |
| 2 | Static rendering, artboard viewport, layers panel, selection | done |
| 3 | Moveable transforms, snapping, undo/redo | done |
| 4 | Inline text editing, properties panel | done |
| 5 | AI provider, prompts, snapshots, daily spend cap | done |
| 6 | Asset upload, isolated export (PNG/JPG/PDF/HTML), autosave | pending |
| 7 | Gradient editor, templates, shortcuts, documentation | pending |

## Original work

All code, copy, icons and visual identity in this repository are original. No
code, asset, icon, template or branding from any other design product is
included. See [`docs/adr/0001-clean-room-canva-parity.md`](docs/adr/0001-clean-room-canva-parity.md).

## License

TBD. Bundled fonts are Google Fonts under the SIL Open Font License; their
license files ship with the web build.
