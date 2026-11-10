# AI Poster Editor

[![CI](https://github.com/mahdialsalkadi/ai-poster-editor/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mahdialsalkadi/ai-poster-editor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

An Arabic-first poster editor built around **Design HTML**. The editor, AI
pipeline and exporter share a canonical `DesignDoc`, with parsing, validation,
serialization and scoped merging in `packages/core`.

> **Development only: do not expose this build publicly.** Authentication and
> security controls are implemented, but deployment, container isolation, TLS
> and live integrations have not yet been verified on a deployment host. See
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

## Deployment (Docker Compose)

The repository ships a four-service topology: `proxy` terminates TLS and serves
the public origin, `web` serves the built editor, `api` runs Fastify and `worker`
runs Chromium. Only the proxy publishes ports. The worker is attached only to an
`internal: true` network, so it cannot reach the internet, the API's outbound
AI/Supabase traffic, or the web service.

1. `cp -n .env.example .env` and set at least:
   - `PUBLIC_ORIGIN` to the exact public `https://` origin, not the dev URL.
   - Supabase Auth: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, an
     `AUTH_COOKIE_SECRET` of 32+ characters and, for HS256 projects,
     `SUPABASE_JWT_SECRET`; alternatively a server-only `API_ACCESS_KEY`.
   - `EXPORT_WORKER_TOKEN` to a random value; compose refuses to start without it.
   - AI settings and both prices if AI is enabled, or `AI_DISABLED=true`.
2. Put `fullchain.pem` and `privkey.pem` in `docker/nginx/certs/`
   (see `docker/nginx/certs/README.md`).
3. Point DNS at the host and run:

```bash
docker compose up --build -d
docker compose ps
```

The proxy probe is `GET /healthz`, the API's is `GET /api/health` and the
worker's is `GET /health`. The API keeps the spend ledger on the `spend` volume,
so run exactly **one** API replica until a shared billing store exists.

Chromium's sandbox is enabled. If the worker reports "No usable sandbox", the
host's Docker seccomp profile is blocking the unprivileged user namespaces the
sandbox needs: apply `docker-compose.sandbox.yml` as an override, or — only
because this worker has no egress and is disposable — set
`EXPORT_CHROMIUM_SANDBOX=false`. Never disable the sandbox on a worker with
network access.

These images and the proxy configuration have not been started on the machine
that prepared them (Docker was unavailable), so container startup, the sandbox
and TLS are **not verified** yet. See [docs/security.md](docs/security.md) for
the threat model and deployment checklist, [docs/runbook.md](docs/runbook.md) for
operations and incident response, and [docs/audit.md](docs/audit.md) for the
verification record. Do not expose the build until that checklist passes.

## What works

- Model-based React rendering, layer selection, Shift-click multi-select,
  move/resize/rotate, snapping, alignment and distribution.
- Arabic/English text layers, RTL inference, 11 self-hosted font families,
  native plain-text inline editing, typography, fills, gradients and SVG layers.
- Undo/redo, duplication, Design HTML copying, and HTML import that converts a
  broader HTML/CSS subset into positioned canonical layers. Import is not a
  browser-equivalent layout engine.
- Marquee and Shift-click selection, an internal layer clipboard with 20px paste
  offsets, Space-drag/wheel pan, and joined Arabic typography with blank lines.
- Debounced IndexedDB document autosave, one validated backup, explicit corruption
  recovery, one-time localStorage migration and atomic stale-tab write protection.
- Optional OpenAI-compatible generation and selection-scoped edits, one retry
  for rejected output, usage reporting, browser-stored edit snapshots and a
  durable daily spend ledger.
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
| Copy / paste layers             | `Ctrl/Cmd + C` / `Ctrl/Cmd + V`                  |
| Pan canvas                      | `Space` + drag, or wheel/trackpad                |
| Marquee selection               | Drag empty canvas; `Shift` adds to selection     |
| Zoom in / out / fit             | `Ctrl/Cmd + +` / `Ctrl/Cmd + −` / `Ctrl/Cmd + 0` |
| Edit text on canvas             | Double-click, `Enter` or `F2`                    |
| Commit / cancel inline text     | `Ctrl/Cmd + Enter` or blur / `Escape`            |
| Nudge / nudge 10px              | arrows / `Shift` + arrows                        |
| Toggle a layer in the selection | `Shift` + click                                  |
| Delete selection                | `Delete` or `Backspace`                          |
| Shortcut sheet                  | `?`                                              |
| Clear selection / close dialog  | `Escape`                                         |

Ctrl/Cmd-wheel zoom is supported. The layer clipboard is internal to the editor
tab; text fields retain native plain-text paste. Inline text uses a `textarea`,
not rich-HTML paste.

## Tests and checks

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:coverage
pnpm build
pnpm test:e2e
pnpm audit --prod
```

The current package test suite has **441 tests**:

| Package | Tests | Files | Main coverage                                                                                       |
| ------- | ----- | ----- | --------------------------------------------------------------------------------------------------- |
| Core    | 288   | 15    | Parser/security corpus, text/units/colors, canonical round trips, merge, import and performance     |
| Server  | 110   | 13    | Auth, mock AI/retries/prompts, spend, export formats/A4 vector PDF/assets/cache/isolation and queue |
| Web     | 43    | 7     | Storage validation, clipboard, marquee geometry, text, templates, snapping, fills and CSP           |

The parser performance test enforces p95 <200 ms for a 200-layer, 200 KiB
document. Coverage gates enforce per-file thresholds on critical parser, style,
CSS guard and merge modules; the separately timed performance test is excluded
from instrumentation. CI also runs 10 browser E2E tests and three export visual
comparisons. See [e2e/goldens/README.md](e2e/goldens/README.md) for the pinned
environment, thresholds and explicit baseline-update process. These exporter
goldens do not establish complete editor/export visual equivalence.

`pnpm format` applies the project's formatter. Byte-exact HTML fixtures, captured
evidence, generated output/lockfile and local tooling are intentionally excluded.
Production audit is a blocking CI step, Dependabot opens grouped weekly updates,
and pnpm resolves no version published less than a day ago (only the data-only
`caniuse-lite` is exempt).

## Known limitations

- **Public-launch security:** access control, route rate limits, scoped export
  caching, browser-only edit snapshots, the sign-in UI, app CSP, the sandboxed
  renderer worker, container isolation, a blocking audit gate and the dependency
  release-age policy are implemented. The containers, proxy TLS and the Docker
  sandbox have not been started on the preparing host, so deployment is unverified
  until the checklist in [docs/security.md](docs/security.md) passes.
- **Spend limits:** the daily total persists in one atomically written file and is
  enforced per attempt, with an optional lower per-principal cap, but it assumes a
  single API replica and manually configured prices. Multiple replicas need a
  shared billing store. All shared API-key clients count as one principal.
- **Dependencies:** Zod was upgraded to the patched 4.6.6 release; `pnpm audit --prod`
  currently reports no known vulnerabilities. Dependency and release-age gates must
  stay in CI as new advisories appear.
- **Persistence:** IndexedDB data is browser-local, not cloud backup or collaborative
  editing. Clearing site data removes documents/assets/snapshots. Corrupt documents
  pause saving for an explicit recovery choice; stale tabs must copy their work or
  reload. Storage behavior, including actual IndexedDB transactions and recovery
  dialogs, is also exercised in Chromium E2E tests in CI.
- **PDF:** the 794x1123 CSS-pixel A4 preset produces an approximately 595x842 pt
  vector page with embedded/selectable Latin text. Older 2480x3508 documents are
  not silently resized. Print-quality Arabic fidelity and visual parity remain
  unverified.
- **Editor:** the layer clipboard is tab-local and marquee uses rotated bounding
  boxes. Interface chrome remains fixed Arabic/RTL; a language toggle is undecided.
- **Gallery/import:** three English and two Arabic layouts, one retained bilingual
  layout and a blank. Broader HTML/CSS import remains best-effort and lossy.
- **AI provider:** OpenAI and OpenAI-compatible APIs only; the optional Anthropic
  adapter is deferred. Unsupported output colors trigger the existing one retry.
- **Configuration:** `EXPORT_CONCURRENCY` and `EXPORT_QUEUE_MAX` can tighten the
  API queue's compiled ceilings, but other export/upload/rate limits remain
  constants in `packages/core/src/limits.ts`. The worker queue is separate.

See [docs/audit.md](docs/audit.md) for evidence, current verdicts and remaining
decisions. Work proceeds one phase at a time; implemented security controls do
not replace the outstanding deployment verification.

## Repository layout

```text
packages/core/       Canonical model, parsing, import, serialization and merge
packages/contracts/ Shared API schemas and error envelopes
apps/web/           Vite + React editor
apps/server/        Fastify API, AI service and Playwright exporter
docker/             API, worker and web images plus the TLS proxy config
prompts/            Generator and scoped-edit system prompts
docs/               Contract, security model, audit and architecture decisions
.github/workflows/  CI and Dependabot
screenshots/        Historical manual verification captures, not visual tests
```

## Milestone status

| Baseline milestone | Existing implementation                                        | Remaining qualification                                  |
| ------------------ | -------------------------------------------------------------- | -------------------------------------------------------- |
| 1                  | Core contract, parser, serializer, merge and tests             | Maintain robustness and coverage gates                   |
| 2–4                | Canvas, selection, transforms, inline editing and inspector    | Full editor/export visual equivalence remains unverified |
| 5                  | Provider, scoped edits, browser snapshots and spend accounting | Container runtime verification remains                   |
| 6                  | Local assets, export formats and IndexedDB autosave            | Upload stub and deployment checks remain                 |
| 7                  | Gradients, balanced gallery, shortcuts and docs                | Release readiness remains                                |

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
