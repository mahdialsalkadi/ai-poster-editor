# AI Poster Editor

An Arabic-first poster editor built around a strict **Design HTML** contract and
an AI generation/edit pipeline. The document is the single source of truth:
the same canonical HTML is parsed, validated, edited, stored, and exported.

> **Clean-room notice:** this project is not affiliated with Canva. We study
> public behavior for feature parity, but we do not copy Canva code, CSS,
> templates, images, icons, fonts, copy, or trademarks. See
> `docs/adr/0001-clean-room-canva-parity.md`.

## Status

Milestone **M0 — contract and safety** is implemented:

- TypeScript-only pnpm monorepo;
- `@poster/core`: model, limits, strict parse5 parser, canonical serializer,
  CSS/SVG allow-lists, runtime Zod schema, selection-scoped merge;
- `@poster/contracts`: API request/response and error schemas;
- unit tests for round trip, security, limits, fonts, SVG, and merge;
- clean-room Canva feature inventory produced with REA;
- CI, Docker, and editor/server scaffolds.

The editor and AI provider are the next milestone. See
`docs/canva-feature-parity.md` for the roadmap.

## Quick start

Requirements: Node.js >= 22, pnpm 12.

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Run the API:

```bash
cp .env.example .env
pnpm --filter @poster/server dev
```

Run the web editor:

```bash
pnpm --filter @poster/web dev
```

## Repository layout

```
apps/
  server/            Fastify API: validate, serialize, merge, AI, export
  web/               Vite + React editor shell
packages/
  core/              Design HTML parser, serializer, canonicalizer, limits
  contracts/         Shared API schemas and error envelopes
docs/
  contract.md        Normative Design HTML contract
  canva-feature-parity.md
  adr/               Architecture decision records
prompts/
  design-html-system.md
  design-edit-system.md
research/canva/      Local REA scenarios (captures are gitignored)
tools/rea/           REA submodule (MIT)
```

## Design HTML in one example

```html
<div class="artboard" data-width="1080px" data-height="1350px" style="background:#0f172a">
  <div
    data-id="headline"
    data-layer="Headline"
    data-type="text"
    dir="rtl"
    style="position:absolute;left:80px;top:120px;width:920px;font-family:'Cairo';font-size:96px;font-weight:700;color:#ffffff;text-align:center;line-height:1.25;letter-spacing:0px"
  >عنوان رئيسي</div>
</div>
```

```ts
import { parseDesignHtml, serializeDesignDoc } from '@poster/core';

const { doc, warnings } = parseDesignHtml(html);
const canonicalHtml = serializeDesignDoc(doc);
```

The parser rejects scripts, event handlers, external URLs, dangerous CSS/SVG,
and anything outside the contract. It never executes or loads content.

## Contract highlights

- **Canonical round trip:** `parse(serialize(doc))` is stable and byte-identical
  on the second serialization.
- **Limits:** 200 KiB, 200 layers, 10k codepoints per text layer, 2k SVG nodes,
  40 MP exports. All limits live in `packages/core/src/limits.ts`.
- **Security:** parse5 + allow-lists; `asset:` image scheme; no scripts, event
  handlers, external references, or `innerHTML` rendering of untrusted HTML.
- **AI merge:** patches update only selected layers; type changes, artboard
  changes, and unselected layers are ignored with warnings.
- **RTL:** Arabic text is inferred as RTL when `dir` is missing; Latin-only fonts
  fall back to Cairo; letter-spacing warns on Arabic.

Full details: [`docs/contract.md`](docs/contract.md).

## Scripts

| Command | Description |
| --- | --- |
| `pnpm test` | run all package tests |
| `pnpm typecheck` | TypeScript project build/check |
| `pnpm build` | build all packages and apps |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |
| `pnpm --filter @poster/core test` | core contract tests |

## Environment

Copy `.env.example` to `.env`. The M0 server runs without external services.
AI and export provider keys are optional until those features are enabled.

## REA

REA is vendored as a git submodule at `tools/rea` (MIT). It is used for
lawful, passive observation of public web UI. It is not a runtime dependency
and is not shipped in the product. If the submodule is not initialized:

```bash
git submodule update --init --recursive
```

The scenarios under `research/canva/` can be replayed with the published CLI:

```bash
npx -y rea-agents@latest capture-browser-scenario research/canva/scenario-editor-ui.json --json
```

Raw captures contain third-party page content and are excluded from git. Do not
commit them or ship them.

## License

TBD. Fonts are distributed under the SIL Open Font License; their license files
must be included in the web build. REA is MIT-licensed and remains a separate
submodule.
