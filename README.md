# AI Poster Editor

[![CI](https://github.com/mahdialsalkadi/ai-poster-editor/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mahdialsalkadi/ai-poster-editor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

An Arabic-first poster editor built around **Design HTML**. The editor, AI
pipeline and exporter share a canonical `DesignDoc`, with parsing, validation,
serialization and scoped merging in `packages/core`.

> **Development only: do not expose this build publicly.** Public deployment is
> the target, with sign-in-protected AI and exports, but authentication and the
> required security hardening are not implemented yet. See
> [Known limitations](#known-limitations) and the [audit](docs/audit.md).

## Requirements

- Node.js **>=22.23.4**, matching `package.json`.
- pnpm **12.16.1** (`npm install --global pnpm@12.16.1`).
- Playwright's Chromium for raster/PDF exports and server export tests. On a
  supported Linux distribution, add `--with-deps` to the browser installation
  command if system libraries are missing.

CI checks Node 22 and the latest available Node. The workflow badge reports
GitHub's actual result; local checks do not imply that a hosted run has passed.
The lockfile and pnpm minimum-release-age policy are retained. Only the
data-only `caniuse-lite` package is exempt from that age policy.

## Quick start

Run these commands from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm --filter @poster/server exec playwright install chromium
cp -n .env.example .env
```

The copy keeps an existing `.env`. Edit it locally; leave `AI_PROVIDER` empty
unless you intend to use a paid or local OpenAI-compatible provider. Typecheck
builds the shared packages needed by the API and web app.

Start the API in one terminal:

```bash
HOST=127.0.0.1 node --env-file=.env --import tsx apps/server/src/index.ts
```

This command explicitly loads the environment file and restricts the listener
to loopback. The bare server `dev`/`start` scripts do not load `.env` themselves;
use an explicit environment loader or export variables before using them.
The web dev proxy expects API port **3001**. Set `PUBLIC_ORIGIN` to the exact
editor origin if you change the URL.

Start the editor in a second terminal:

```bash
pnpm --filter @poster/web dev --host 127.0.0.1
```

Open <http://127.0.0.1:5173>. API health is available at
<http://127.0.0.1:3001/api/health>. Do not use a public bind address, tunnel or
reverse proxy to expose this development setup.

## What works

- Model-based React rendering, layer selection, Shift-click multi-select,
  move/resize/rotate, snapping, alignment and distribution.
- Arabic/English text layers, RTL inference, 11 self-hosted font families,
  native plain-text inline editing, typography, fills, gradients and SVG layers.
- Undo/redo, duplication, Design HTML copying, and HTML import that converts a
  broader HTML/CSS subset into positioned canonical layers. Import is not a
  browser-equivalent layout engine.
- Optional OpenAI-compatible generation and selection-scoped edits, one retry
  for rejected output, usage reporting and in-memory snapshots/spend accounting.
- Local image upload and IndexedDB asset storage. Export uploads only referenced
  image bytes for server-side revalidation; `POST /api/assets` remains a stub.
- PNG/JPEG export at 1x/2x/3x, native vector PDF and self-contained HTML export.
  Hidden layers are omitted and fonts/images are embedded.

## Design HTML

The canonical interchange form is a single `.artboard` containing positioned
text, shape, image or SVG layers. Artboard attributes serialize with `px`:

```html
<div class="artboard" data-width="1080px" data-height="1350px" style="background:#0f172a">
  <div
    data-id="headline"
    data-layer="Headline"
    data-type="text"
    dir="rtl"
    style="position:absolute;left:80px;top:120px;width:920px;font-family:'Cairo';font-size:96px;font-weight:700;color:#ffffff;text-align:right;line-height:1.25;letter-spacing:0px"
  >
    عنوان رئيسي
  </div>
</div>
```

```ts
import { parseDesignHtml, serializeDesignDoc } from '@poster/core';

const { doc, warnings } = parseDesignHtml(html);
const canonicalHtml = serializeDesignDoc(doc);
```

`parseDesignHtml` handles the restricted interchange form; the editor's
`importDesignDocument` path also handles full exported HTML and broader HTML/CSS
input. These are different boundaries. See the [contract](docs/contract.md)
for canonicalization, import behavior, security rules and current API behavior.

## Editor shortcuts

| Action                          | Shortcut                                         |
| ------------------------------- | ------------------------------------------------ |
| Save now                        | `Ctrl/Cmd + S`                                   |
| Open export                     | `Ctrl/Cmd + E`                                   |
| Undo / redo                     | `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z`          |
| Duplicate selection             | `Ctrl/Cmd + D`                                   |
| Zoom in / out / fit             | `Ctrl/Cmd + +` / `Ctrl/Cmd + −` / `Ctrl/Cmd + 0` |
| Edit text on canvas             | Double-click, `Enter` or `F2`                    |
| Commit / cancel inline text     | `Ctrl/Cmd + Enter` or blur / `Escape`            |
| Nudge / nudge 10px              | arrows / `Shift` + arrows                        |
| Toggle a layer in the selection | `Shift` + click                                  |
| Delete selection                | `Delete` or `Backspace`                          |
| Shortcut sheet                  | `?`                                              |
| Clear selection / close dialog  | `Escape`                                         |

Ctrl/Cmd-wheel zoom is supported. Layer copy/paste, marquee selection and canvas
pan are not implemented. Inline text uses a `textarea`, not rich-HTML paste.

## Tests and checks

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm audit --prod
```

The current test suite has **257 tests**:

| Package | Tests | Files | Main coverage                                                                              |
| ------- | ----- | ----- | ------------------------------------------------------------------------------------------ |
| Core    | 166   | 12    | Parser/security corpus, canonical round trips, merge, import, HTML goldens and performance |
| Server  | 47    | 4     | Mock AI, spend refusal, basic limits, snapshots, export formats/assets and queue           |
| Web     | 25    | 3     | Snapping, fills and templates                                                              |

The parser performance test enforces p95 <200 ms for a 200-layer, approximately
56.4 KiB document. It does not establish a 1–3 ms guarantee or a full-200-KiB
performance budget. HTML goldens and saved screenshots are not automated visual
comparisons. There is no E2E suite or editor/export visual-equivalence gate yet.

`pnpm format` applies the project's formatter. Byte-exact HTML fixtures, captured
evidence, generated output/lockfile and local tooling are intentionally excluded.
The production audit step is advisory in Phase 1; its warnings still block public
release readiness until resolved or explicitly assessed.

## Known limitations

- **Public-launch security blockers:** no authentication, incomplete route rate
  limits, caller-readable snapshots, unscoped export idempotency, no app CSP and
  insufficient renderer/deployment isolation. Offline browser contexts and an
  export CSP are not a hardened worker boundary.
- **Spend limits:** the daily total persists in one atomically written file and is
  enforced per attempt, but it assumes a single API replica and manually configured
  prices. Multiple replicas need a shared billing store.
- **Dependencies:** Zod was upgraded to the patched 4.6.6 release; `pnpm audit --prod`
  currently reports no known vulnerabilities. Dependency and release-age gates must
  stay in CI as new advisories appear.
- **Persistence:** documents use debounced `localStorage`; only image assets use
  IndexedDB. There is no backup/recovery flow or multi-tab overwrite protection.
  Server snapshots are in memory and have no editor list/restore UI.
- **PDF:** selectable native text and embedded fonts were verified for a Latin
  probe, but the 2480x3508 A4 preset exports at the wrong physical paper size.
  Print-quality Arabic fidelity and editor/export visual parity remain unverified.
- **Editor:** no marquee, layer clipboard or pan; Arabic letter spacing remains
  enabled; consecutive blank lines collapse; interface chrome is fixed Arabic/RTL.
- **Gallery/import:** four designed templates plus a blank, not five finished
  language-balanced layouts. Broader HTML/CSS import is best-effort and lossy.
- **Configuration:** export/upload/rate limits currently use constants in
  `packages/core/src/limits.ts`, not environment overrides. The example environment
  file only lists settings the server actually reads.

See [docs/audit.md](docs/audit.md) for evidence, current verdicts and remaining
decisions. Work proceeds one phase at a time; Phase 1 repository hygiene does
not close the Phase 2 security findings.

## Repository layout

```text
packages/core/       Canonical model, parsing, import, serialization and merge
packages/contracts/ Shared API schemas and error envelopes
apps/web/           Vite + React editor
apps/server/        Fastify API, AI service and Playwright exporter
prompts/            Generator and scoped-edit system prompts
docs/               Contract, audit and architecture decisions
.github/workflows/  CI
screenshots/        Historical manual verification captures, not visual tests
```

## Milestone status

| Baseline milestone | Existing implementation                                     | Remaining qualification                                  |
| ------------------ | ----------------------------------------------------------- | -------------------------------------------------------- |
| 1                  | Core contract, parser, serializer, merge and tests          | Broader robustness/coverage gates remain                 |
| 2–4                | Canvas, selection, transforms, inline editing and inspector | Editor gaps listed above remain                          |
| 5                  | Provider, scoped edits, snapshots and spend accounting      | Public-service safety and snapshot UX remain             |
| 6                  | Local assets, export formats and autosave                   | Upload API, isolation, persistence and PDF sizing remain |
| 7                  | Gradients, gallery, shortcuts and docs                      | Gallery/language balance and product polish remain       |

These are functional implementations, not a claim that all original acceptance
criteria or public-release gates are complete. See [CHANGELOG.md](CHANGELOG.md)
for the `v0.1.0` baseline checkpoint and subsequent changes.

## Contributing a template

Templates are `DesignDoc` factories in `apps/web/src/sample.ts`, registered in
`TEMPLATES`. Follow the canonical model and run `pnpm --filter @poster/web test`;
`sample.test.ts` checks template structure and round trips. The current gallery
uses 1080x1350 artboards.

## Original work and license

Project code, copy, icons and layouts are original; no code, branding or templates
from another design product are included. The bundled third-party fonts are
listed separately. See the [architecture decision](docs/adr/0001-clean-room-canva-parity.md).

Original project code is [MIT licensed](LICENSE). Fonts retain OFL-1.1; their
upstream copyright notices and license texts ship with the web build. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for all 11 families.
