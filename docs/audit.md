# Completion and hardening audit — Phase 0

Date: 9 November 2026. Baseline: `947349a` on `main` (26 commits).
Repository: <https://github.com/mahdialsalkadi/ai-poster-editor>.

The initial Phase 0 verification checked **Completion and Hardening Plan v1.1**
against the local source/runtime without changing application code, dependencies
or configuration. Its findings and citations describe the baseline above.
Subsequent owner-approved decisions and Phase 1 changes are recorded in the
follow-ups below. No live AI provider was called; public deployment is not approved.

## Verdicts

**PASS** means the alleged defect is contradicted by current evidence and its
original fix should be dropped. **FAIL** means work remains; a partial finding
is narrowed in the notes rather than treating its passing parts as broken.
Severity follows the plan: H blocks public deployment, M blocks v1.0, L is polish.
Paths and line numbers refer to the baseline, not generated build output.

| Finding                      | Verdict                      | Evidence (file:line)                                                                                                                                              | Proposed action                                                                                                                                   |
| ---------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 · CI                      | FAIL · M                     | `README.md:10`; `package.json:10-17`                                                                                                                              | Add a real workflow and badge; no workflows are tracked.                                                                                          |
| R2 · License                 | FAIL · M, narrowed           | `README.md:12,316-317`; `package.json:1-29`; `apps/web/scripts/copy-font-licenses.mjs:49-78`                                                                      | Decide D1 and add a project license/notices. Font license distribution already works.                                                             |
| R3 · Documentation           | FAIL · L                     | `README.md:64-81,181-217,285-317`; `docs/contract.md:371-372,440-456,525-527,587-594`                                                                             | Deduplicate and correct contract, versions, test counts and implemented/stubbed routes.                                                           |
| R4 · Artboard units          | FAIL · L                     | `packages/core/src/parse.ts:527-534`; `packages/core/src/numbers.ts:31-37`; `packages/core/src/serialize.ts:172-173`                                              | Accept bare dimensions at the artboard boundary; preserve canonical `px`.                                                                         |
| S1 · Access and limits       | FAIL · H if public           | `apps/server/src/app.ts:19-32,62-65`; `apps/server/src/routes/ai.ts:10-17`; `apps/server/src/routes/design.ts:15-47`                                              | Add authentication, explicit proxy/origin policy and limits on all expensive routes.                                                              |
| S2 · Spend cap               | FAIL · H if public, narrowed | `apps/server/src/ai/spend.ts:24-64`; `apps/server/src/ai/service.ts:245-277,283-303`                                                                              | Persist the ledger; reserve for retries; require valid prices and add a kill switch. Output tokens are already included.                          |
| S3 · Server state            | FAIL · H                     | `apps/server/src/ai/snapshots.ts:16-54`; `apps/server/src/export/service.ts:23-27,51-55,85-91`; `apps/server/src/routes/ai.ts:46-62`                              | Move snapshots to browser storage or add ownership/TTL/global caps; scope and bound export caching.                                               |
| S4 · Export isolation        | FAIL · H                     | `apps/server/src/export/renderer.ts:15-26,37-52,76-103,129-130`; `apps/server/package.json:21`                                                                    | Use an explicitly sandboxed, scrubbed, resource-limited worker with network denial and a total deadline.                                          |
| S5 · Web CSP/rendering       | FAIL · M, narrowed           | `apps/web/index.html:1-13`; `apps/web/vite.config.ts:4-15`; `apps/web/src/components/LayerView.tsx:69-90,156-178`                                                 | Add app CSP and tests. Keep the existing model-based React renderer; no HTML-injection rewrite is needed.                                         |
| S6 · Operations              | FAIL · M, narrowed           | `apps/server/src/app.ts:20-24,48-60`; `apps/server/src/index.ts:3-23`; `.env.example:1-31`                                                                        | Add deployment isolation, proxy/runbook guidance, explicit redaction and kill switches. Health and structured logging already exist.              |
| P1 · Named colors            | PASS · drop original fix     | `packages/core/src/color.ts:11-164,270-275`; `packages/core/src/style.ts:1105-1119`                                                                               | Do not reimplement the expanded color table. Separately decide whether unsupported-color warnings should retry.                                   |
| P2 · PDF fidelity            | FAIL · M, narrowed           | `apps/server/src/export/renderer.ts:93-105`; `apps/web/src/components/Inspector.tsx:341-347`                                                                      | Keep native vector PDF. Correct the actual A4 preset's physical sizing and add page-size/text tests.                                              |
| P3 · Autosave                | FAIL · M, narrowed           | `apps/web/src/App.tsx:257-273,320-334,514-525`; `apps/web/src/editor/storage.ts:8-10,61-82`                                                                       | Move documents to IndexedDB with backup/recovery/migration and multi-tab protection. Validation, debounce and visible quota errors already exist. |
| P4 · Snapshot UX             | FAIL · M                     | `apps/web/src/App.tsx:477-503`; `apps/web/src/editor/api.ts:130,154-159`                                                                                          | Preserve snapshot metadata and implement a persistent list/restore UI.                                                                            |
| P5 · Editor gaps             | FAIL · M, narrowed           | `apps/web/src/components/Canvas.tsx:70,195-207,425-447,534-563`; `apps/web/src/App.tsx:559-648`; `apps/web/src/components/Inspector.tsx:662-669,1059-1075`        | Add marquee, layer copy/paste and pan; disable Arabic letter spacing. Shift-select, plain-text input and multi-select alignment already exist.    |
| P6 · Blank lines             | FAIL · L–M                   | `packages/core/src/text.ts:46-51,77-79`; `docs/contract.md:126-129`                                                                                               | Decide the two-break policy, then change parser/canonicalizer/contract together with tests.                                                       |
| P7 · Providers               | FAIL · L, optional decision  | `apps/server/src/ai/provider.ts:31,43-60,83-103`; `.env.example:18-21`                                                                                            | Document the current OpenAI-compatible scope; an Anthropic adapter requires D7, not an automatic dependency addition.                             |
| P8 · Prompts/templates/fonts | FAIL · L, narrowed           | `prompts/design-html-system.md:29-81`; `prompts/design-edit-system.md:12-15,33-58`; `apps/web/src/sample.ts:489-495`; `apps/server/src/export/fonts.ts:6-7,46-50` | Correct the gallery mix; make hex-only colors explicit in the edit prompt. Retain existing canonical wrappers, font subsets and licenses.         |
| T1 · Test coverage           | FAIL · H, narrowed           | `apps/server/test/ai.test.ts:91-177,300-359`; `apps/server/test/export.test.ts:135-288,291-312`; `vitest.config.ts:4-13`                                          | Extend the existing 235 tests with missing security, E2E and visual gates; do not rebuild an allegedly absent server suite.                       |

The tracked-file inventory contains no CI workflow, E2E suite, Docker/compose
configuration, project `LICENSE`, notices or changelog. `.github/` and `e2e/`
exist as empty local directories; their existence is not evidence of automation.
The pre-existing untracked `tools/` directory was left untouched and is not part
of the application inventory.

## Security verification

### S1 — Identity, origin and rate limits

- There is no authentication hook or production access-key startup check.
  An unauthenticated `/api/design/validate` request returned HTTP 200.
- `PUBLIC_ORIGIN` restricts CORS when set; when absent, `origin: true` reflects
  arbitrary origins (`apps/server/src/app.ts:28-32`). CORS is not authentication.
- Fastify has no `trustProxy` option; its default is false. Behind a reverse proxy,
  all clients may share the proxy's IP. Do not simply enable trust for all proxies.
- A session is the caller-controlled `x-session-id`, falling back to `request.ip`.
  The project is caller-controlled `x-project-id`, falling back to `default`
  (`apps/server/src/routes/ai.ts:10-17`). The web client sends neither header
  (`apps/web/src/editor/api.ts:50-58`), so normal clients share the default project.
- Generation has per-IP and per-session limits; editing has only the per-IP limit
  (`apps/server/src/ai/service.ts:90-97,108-109,157`). Design routes, snapshot reads
  and exports have no rate limiter. Export/upload constants in
  `packages/core/src/limits.ts:72-78` do not enforce themselves.

### S2 — Spend accounting

The existing reservation is:

```text
estimatePromptTokens(messages) × inputPrice / 1,000,000
+ maxOutputTokens × outputPrice / 1,000,000
```

Output tokens are included, contrary to the plan's tentative concern. However,
`AiService.attempt` reserves once outside the retry loop. A mock provider with
zero input price, $1/output-token, a 100-token maximum and a $150 cap returned
100 output tokens on each of two attempts. Both calls ran and settled to $200.
This is a deterministic accounting reproduction, not a paid provider request.

Additional gaps:

- The ledger is process memory, reset on restart and independent per instance.
- The prompt estimate is `ceil(characterCount / 4)`, not a proven upper bound,
  especially for Arabic (`apps/server/src/ai/prompt.ts:116-119`). Retry feedback
  adds input tokens too.
- Missing/invalid prices silently fall back to 0.15/0.6, independent of model;
  zero spend-cap configuration falls back to $5
  (`apps/server/src/ai/service.ts:283-303`).
- Missing provider token usage becomes zero; a provider reply with no text
  throws before returning usage (`apps/server/src/ai/provider.ts:73-79,119-130`).
- There is no `AI_DISABLED` check or settlement logging. Disabling/unsetting the
  provider is the current coarse switch, requiring service reinitialization.

### S3 — Long-lived in-memory state inventory

| Store                                | Lifetime/TTL                                                                                      | Cap and ownership                                                                                                                                     | Evidence                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Daily spend/reservations             | Process lifetime; resets on UTC day change                                                        | Dollar cap only; no persistence or cross-instance coordination                                                                                        | `apps/server/src/ai/spend.ts:24-64`                                                                                           |
| Snapshot documents and project index | Process lifetime; no TTL                                                                          | 20 snapshots/project; no global count/byte/project cap; no owner check                                                                                | `apps/server/src/ai/snapshots.ts:16-54`; `packages/core/src/limits.ts:69-70`                                                  |
| Export idempotency results           | Process lifetime; no TTL                                                                          | FIFO 20 entries; each output ≤40 MiB, so retained buffers alone can approach 800 MiB; no aggregate byte budget, caller scope or request-content match | `apps/server/src/export/service.ts:23-27,51-55,68-70,85-91`                                                                   |
| AI limiter keys/timestamps           | Sliding 60-second or one-hour windows; stale entries removed on reuse or pruning above 5,000 keys | No hard key cap; active attacker-chosen session keys remain                                                                                           | `apps/server/src/ai/rate-limit.ts:3-27`; `apps/server/src/ai/service.ts:90-97`                                                |
| Render queue and shared browser      | Process lifetime; queue has no waiting TTL                                                        | 2 active / 20 waiting renders; no ownership; asset preparation occurs before queue admission                                                          | `apps/server/src/export/queue.ts:7-33`; `apps/server/src/export/service.ts:57-67`; `apps/server/src/export/renderer.ts:15-35` |
| Embedded font CSS cache              | Process lifetime; no TTL                                                                          | Bounded by the allowed 11 font families on validated export paths                                                                                     | `apps/server/src/export/fonts.ts:9,33-63`; `packages/core/src/fonts.ts:1-42`                                                  |
| System prompt cache                  | Process lifetime; no TTL                                                                          | Two fixed keys (`generate`, `edit`)                                                                                                                   | `apps/server/src/ai/prompt.ts:5-26`                                                                                           |

Request-local maps (`routes/export.ts:35-36`, `export/service.ts:57`) are not
persistent stores, but still hold uploaded/decoded bytes while requests wait.

Two local Fastify-injection reproductions confirmed data separation failures:

1. An edit under one project/session created a snapshot. A different IP,
   project and session fetched that snapshot with HTTP 200. IDs are predictable
   `snap-<base36 timestamp>-<counter>`, not random capabilities.
2. An export from a different IP and different document reused the first
   request's idempotency key. The second response was a cache hit containing the
   first document. There was no authentication on either request.

### S4 — Renderer launch and containment

Passing controls: a fresh browser context per export, `javaScriptEnabled: false`,
`offline: true`, blocked service workers, self-contained fonts/images, and an
export CSP (`apps/server/src/export/renderer.ts:79-91`;
`apps/server/src/export/serialize.ts:170-198`). "JavaScript-free" means document
scripts are disabled; trusted Playwright evaluation of `document.fonts.ready`
still runs and succeeded during PDF export.

Missing controls:

- `chromium.launch()` supplies neither `env` nor `chromiumSandbox`. Installed
  Playwright 1.65.0 defaults to `process.env` and adds `--no-sandbox` unless
  explicitly enabled. Dependency evidence:
  `node_modules/.pnpm/playwright-core@1.65.0/node_modules/playwright-core/lib/coreBundle.js:41611-41619,45187-45188`.
  A local direct-child process probe did **not** independently establish the
  final Chromium environment/flags; do not treat these library defaults as an
  observed production process command line. No real key was inspected: that
  probe used a fake sentinel. An explicit launch policy and deployment test are
  still required.
- No request interception aborts outbound requests. Offline mode and the CSP are
  useful page-level controls, not container-level network denial.
- No dedicated worker deployment, CPU/memory limits, container egress policy or
  enforced non-root deployment exists. This host ran the probes as UID 1000;
  that does not enforce the identity of future deployments.
- Each operation has its own 15-second timeout; serialization, browser launch,
  queue wait and context close are not covered by one total deadline. Timeout
  rejects a promise and eventually closes the context; it does not kill the
  worker process tree (`renderer.ts:37-52,76-91,129-130`).
- The lockfile resolves Playwright 1.65.0 / Chromium revision 1254, but the
  manifest uses `^1.65.0`. There is no pinned worker image.

### S5–S6 — Web boundary and operations

There are no `innerHTML` or `dangerouslySetInnerHTML` uses in the web source.
Text is rendered as React children and SVG as validated nodes, not injected
Design HTML (`apps/web/src/components/LayerView.tsx:69-90,156-178`).
The built app served by Vite preview had neither a CSP response header nor a
CSP meta tag. Export's CSP does not protect the editor itself.

The health endpoint and Fastify's structured logger already exist. Explicit
credential redaction, deployment artifacts, metrics, reverse-proxy guidance and
operational switches do not. The server binds to `0.0.0.0` by default
(`apps/server/src/index.ts:3-4`). Scripts do not load `.env` themselves
(`apps/server/package.json:7-12`; `apps/server/src/index.ts:1-6`), so copying
`.env.example` alone does not implement the README's configuration instructions.
Several documented export/upload/rate environment settings are not read by
these implementation paths; hardcoded `LIMITS` currently govern them.

`AI_API_KEY` source inventory: the value is read at
`apps/server/src/ai/provider.ts:46`, held in provider configuration, and used in
the outbound authorization header at `provider.ts:95`. Other mentions are
configuration instructions (`routes/ai.ts:23`, `AiPanel.tsx:45`), docs/example
configuration and dummy values in `apps/server/test/ai.test.ts:280-285`.
No web code reads the credential value. The real `.env` was not opened.

## Correctness and product verification

### Colors and artboard units

Runtime parsing normalized `orange`, `gold`, `navy` and `rebeccapurple` to their
hex values. An unknown text color fell back to opaque `#000000`, not transparent
text. The named-color defect as written is obsolete; `docs/contract.md:283-287`
needs correction. An unknown-color warning was returned after **one** mock AI
call, confirming warnings do not trigger a retry. Keep that policy decision
separate from replacing the already expanded color table.

Bare `data-width="794" data-height="1123"` was rejected with
`INVALID_DOC: Artboard must specify width and height in px`. The `px` variant
parsed and serialized with canonical `px`. Both prompt examples already use
canonical units.

### PDF measurements

The implementation calls Chromium `page.pdf`, not a screenshot-to-PDF converter.
For an explicit **794 × 1123 CSS-pixel** document:

- `pdfinfo`: one page, **595.92 × 842.88 pt**, approximately A4, with Chromium's
  page-size rounding;
- `pdftotext`: extracted `Phase zero PDF selectable text`;
- `pdffonts`: Inter-Regular was embedded, subsetted, with a Unicode map.

However, the actual UI's **A4 preset is 2480 × 3508**
(`apps/web/src/components/Inspector.tsx:347`), presumably 300-DPI raster intent.
It exported as **1860 × 2632.08 pt**, approximately 656 × 929 mm, not A4.
The preset and PDF physical-size policy must agree. The plan's assumed A4
preset dimensions were wrong, but there is a real physical-sizing defect.
Retain vector output; add regression assertions rather than replacing it.
Arabic extraction/fidelity, color management and print-production suitability
were not established by this Latin-text probe.

### Persistence, snapshots and editor controls

- Documents use `localStorage`, assets use IndexedDB. The doc is debounced by
  700 ms, contains `schemaVersion`, and is validated on load. Unsupported or
  corrupt data silently falls back to a template and can then be overwritten.
  There is no backup/recovery prompt, migration or multi-tab conflict guard.
- A simulated document quota error displayed `تعذر الحفظ` (save failed); the
  temporary browser-only override was restored. Do not add a second error-state
  implementation. Asset IndexedDB errors are swallowed
  (`apps/web/src/editor/storage.ts:23-58,61-82`).
- The AI edit handler discards the returned snapshot ID. There is no snapshot
  list/get/restore client or persisted snapshot history. Undo history is not a
  substitute that survives reload.
- Obscura inspection of the built editor confirmed Shift-click selected both
  `headline` and `body`, exposing the multi-select alignment controls. Distribution
  requires three layers. Those features should not be reimplemented.
- Inline text uses a native `textarea`, so rich markup is not pasted as HTML.
  The Arabic letter-spacing input remains enabled. The current templates even
  give Arabic subheadings nonzero spacing (`apps/web/src/sample.ts:129-142,316-329`).
- No marquee session, layer clipboard shortcuts or Space-drag pan exists.
  Ctrl/Cmd-wheel zoom exists; ordinary wheel/trackpad input is not implemented
  as canvas pan. Duplication is not copy/paste.
- `First<br><br>Last` parsed to one break, confirming blank lines collapse.
- The editor chrome is fixed Arabic/RTL (`apps/web/index.html:2`;
  `apps/web/src/App.tsx:651`). The AI output-language selector is not a UI-language
  toggle; D6 remains a product decision.

### Prompts, templates and fonts

- Both system prompts specify `.artboard` wrappers and use canonical `px`.
  The generator explicitly requires hex colors, Arabic-capable fonts, no Arabic
  letter-spacing, hierarchy, margins, contrast and restrained palettes. The edit
  prompt preserves scope/identity and contrast but only refers to contract colors;
  make its hex-only policy explicit when editing prompts.
- The gallery has **five entries but four designed layouts plus a blank**:
  Midnight and Coffee are Arabic-led, Paper is English, Neon is bilingual, and
  Blank has no text. It is not three English and two Arabic designed templates.
- All 11 OFL texts are tracked in `apps/web/public/licenses/`; the generated
  `index.json` lists all 11 as `OFL-1.1`. Build copied **11/11** license texts to
  the distribution. Project licensing is a separate unresolved issue.
- Fontsource already supplies language-subset woff2 files. The web imports
  400/700 CSS (including more scripts and woff fallbacks than this app needs),
  while export embeds available Arabic/Latin 400/700 subsets. Further bundle
  reduction may help; "no shipped subsets" is not a current defect.

## Tests and verification log

Environment: Linux, Node **22.23.1**, pnpm **12.16.1**. Node is slightly below the
manifest's **>=22.23.4** requirement: these results are observations on this host,
not certification of the supported-version CI matrix. No dependencies were added.

| Check                                                | Observed result                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                                         | PASS; font licenses copied 11/11                                                                               |
| `pnpm typecheck`                                     | PASS                                                                                                           |
| `pnpm test`                                          | PASS: core 163 / 11 files, server 47 / 4 files, web 25 / 3 files; 235 total                                    |
| `pnpm lint`                                          | FAIL; also traverses the unrelated untracked `tools/` tree                                                     |
| Tracked-file ESLint check                            | FAIL: exactly 3 baseline errors, listed below                                                                  |
| Tracked-file Prettier check                          | FAIL: 70 baseline files; nothing reformatted                                                                   |
| Local TypeScript/Fastify mock probes                 | Confirmed unit rejection, color behavior, retry overspend and cross-caller snapshot/export access              |
| Built web app at `http://127.0.0.1:4179` via Obscura | Confirmed missing CSP, Shift-select/alignment, textarea editing, enabled Arabic spacing and visible save error |
| Actual PDF exports + Poppler tools                   | Confirmed native selectable text/embedded font and incorrect physical size of the UI's A4 preset               |

Baseline lint errors:

- `packages/core/src/import.ts:4`: unused `containsForbiddenCss`.
- `packages/core/src/parse.ts:348`: `let id` should be `const`.
- `packages/core/src/style.ts:27`: unused `clamp`.

Tracked-only checks, avoiding the user's untracked tooling:

```bash
git ls-files -z '*.ts' '*.tsx' '*.js' '*.mjs' | xargs -0 pnpm exec eslint
git ls-files -z | xargs -0 pnpm exec prettier --check --ignore-unknown
```

The full `pnpm format:check` was not run because it also scans untracked tooling;
the tracked-only check already establishes baseline formatting failures.
Golden HTML fixtures need an explicit formatting policy: blindly formatting them
can invalidate byte-stability expectations.

Temporary local reproduction artifacts are under `/tmp/opencode/`:

- `poster-audit-{build,typecheck,tests,lint,lint-tracked,format-tracked}.log`;
- `poster-phase0-probes.mts`, `.json`, `.log` (mock-only API/accounting probes);
- `poster-phase0-renderer.mts`, `.json` (limited direct-child inspection);
- `poster-phase0-preset.mts`;
- `poster-phase0-a4.pdf` and `poster-phase0-actual-a4-preset.pdf`.

These are local scratch artifacts, not portable repository fixtures. Re-run the
`.mts` probes with `pnpm exec tsx /tmp/opencode/<file>.mts` on this checkout.
Inspect PDFs with `pdfinfo`, `pdftotext <file> -` and `pdffonts`.
The audit records their results so it does not rely on scratch files surviving.

### T1 — Existing coverage versus remaining gates

Existing server tests cover mocked AI generation/editing, one retry, invalid
output rejection, basic rate limiting, spend refusal before provider calls,
snapshot retrieval, PNG/JPEG/PDF/HTML export, missing/non-image assets,
pixel limits, idempotency and queue concurrency. The claim of "no server tests"
is false. Stored screenshots are not automated visual-regression tests.

Still absent or insufficient:

- Authentication/ownership, durable spend, retry reservation and concurrent cap
  tests; snapshot/cache expiry and aggregate caps; design-route limits.
- End-to-end editor flows and a three-design visual comparison with pinned
  browser/fonts and golden-update commands.
- Actual PDF page geometry, text extraction and editor/export fidelity assertions:
  the existing PDF test only checks the file signature and response metadata
  (`apps/server/test/export.test.ts:169-181`).
- Queue-full HTTP **429**: the implementation throws `LIMIT_EXCEEDED`, mapped to
  **413** (`apps/server/src/export/queue.ts:16-20`;
  `packages/contracts/src/api.ts:14-24`). The queue test only checks the code.
- Oversized side rejection **before decode**: `prepareAsset` checks dimensions
  after `sharp(...).toBuffer`; its input-pixel guard is useful but not a header-side
  preflight (`apps/server/src/export/assets.ts:38-59`). Browser uploads likewise
  load an image before dimension checks (`apps/web/src/editor/assets.ts:66-107`).
  `POST /api/assets` is still an unsupported stub; uploads currently happen locally
  and bytes are revalidated on export (`apps/server/src/routes/assets.ts:5-11`).
- Polyglot/aggregate-asset limits, hidden-layer output, total-timeout/process-tree
  cleanup and actual network-denial tests. HTML self-containment assertions do not
  prove OS-level isolation.
- Coverage thresholds are not configured; package-local Vitest configs do not
  add them. Existing fast-check tests generate model documents, not arbitrary
  hostile HTML. The performance test enforces p95 <200 ms on a **56.4 KiB**,
  200-layer document, not the full 200 KiB boundary
  (`packages/core/test/perf.test.ts:71-95`). Observed p50 15.57 ms / p95 59.59 ms.

## Review checkpoint and decisions

Audit-document checks passed: `pnpm exec prettier --check docs/audit.md`, exactly
19 unique finding rows, and existence/range checks for the fully qualified source
citations. No application fixes were made to turn baseline failures green.

Phase 0 is complete as an evidence audit, **not** as remediation. Only this
document is intended for the Phase 0 commit. Do not start the next phase, install
dependencies, tag a release, push, or deploy without review.

Before Phase 1, decide **D1 (project license)**. Also establish **D2 (private vs
public deployment)** before security design. Browser snapshots (D3), unsupported
color retry behavior (D4), print requirements (D5), UI language (D6) and provider
scope (D7) remain decisions; no preferences were silently selected.

Adjust the later phases to preserve working font licensing/subsets, expanded
named colors, native PDF rendering, server tests, health/logging, Shift-select,
plain-text editing, alignment and existing save-error handling. Prioritize the
confirmed access, spend and cache-isolation failures before public exposure.

## Licensing follow-up — 9 November 2026

After the Phase 0 review, the owner selected **MIT** for **D1**. This follow-up
implements only the Phase 1 licensing task; it does not complete Phase 1 or
authorize deployment. The original R2 row above records the historical baseline.

**R2 current verdict: remediated.** The root `LICENSE` contains the MIT terms,
`package.json` declares `"license": "MIT"`, and the README's badge and license
section now agree. `THIRD_PARTY_NOTICES.md` identifies all 11 font packages,
links their unchanged upstream copyright/license files, and reproduces the
common OFL 1.1 terms verbatim. Fonts retain OFL-1.1; they are not relicensed MIT.

Verification: `pnpm exec tsx /tmp/opencode/poster-license-check.mts` passed checks
for MIT metadata/text, README links, all 11 notices, byte-equivalent upstream
OFL terms and built license copies. `pnpm --filter @poster/web build` passed and
copied all 11 font notices; the checker passed again against the fresh build.
Formatting checks passed for `package.json`, `THIRD_PARTY_NOTICES.md` and this
audit; existing README formatting issues were not changed. The checker is a local
scratch artifact, not a new application dependency.

All other findings remain as audited. At the end of this licensing change,
D2–D7 were still undecided. No release tag, dependency addition, push or deployment
was part of the licensing change.

## Deployment decision — 9 November 2026

The owner selected **public deployment** for **D2**, following the recommendation
of a publicly accessible editor with sign-in-protected AI and export operations.
This records the target; authentication and hosting are not implemented by this
decision, and the current build is not approved for public exposure.

All Phase 2 hardening items are now required before public deployment, including
access control, rate limits, persistent spend accounting with retry-safe
reservations, snapshot/cache ownership, export isolation, app CSP and deployment
controls. Provider credentials and any shared backend access key must remain on
the server, never embedded in the public web bundle.

Continue in phase order: finish the remaining Phase 1 safety-net/repository tasks,
then implement and test Phase 2 before any public staging or production exposure.
The security findings above remain open; choosing a public target does not make
them pass. D1 is MIT, D2 is public, and D3–D7 remain undecided. No provider,
authentication dependency, hosting service or deployment action was selected or
added as part of this decision.

## Phase 1 execution — 9 November 2026

The owner approved continuing with the remaining Phase 1 tasks. Security changes
and public deployment remain outside this phase.

### Version checkpoint

`CHANGELOG.md` records the existing 0.1.0 feature set and its known security
limitations. The local annotated `v0.1.0` tag identifies this checkpoint before
the remaining source/configuration cleanup. MIT licensing and deployment-target
decisions had already been committed; the tag does not retroactively precede
those changes or claim a production-ready release. No existing tag was replaced.

Verification: the tag inventory was empty, changelog formatting was checked, and
the checkpoint contains documentation only. The tag was initially local; its
subsequent push is recorded in the hosted verification below.

### Baseline quality gates

The three lint failures were corrected: two unused imports were removed and the
unmodified layer ID binding is now `const`. The existing Prettier configuration
was applied to application source, tests and documentation. `.prettierignore`
protects byte-exact HTML fixtures, generated output/lockfile, captured evidence
and local tooling; ESLint also excludes the tooling/capture directories.

Verification: `pnpm lint`, `pnpm format:check` and `pnpm typecheck` all passed.
`pnpm test` passed all 235 tests (core 163, server 47, web 25). A Git diff check
confirmed no changes to either fixture tree, stored screenshots or
`pnpm-lock.yaml`. The untracked `tools/` tree was not changed. Results were
obtained on Node 22.23.1, with the same supported-version caveat as Phase 0.
These gates now work on the whole application, not just a tracked-file subset.

### CI configuration

`.github/workflows/ci.yml` runs on main pushes, pull requests and manual dispatch,
using Node 22 and the latest available Node with pnpm 12.16.1. It performs a frozen
install, typecheck, lint, format check, Chromium/system dependency installation,
tests and build. Production dependency audit is explicitly non-blocking during
Phase 1. Actions are pinned to verified release commit SHAs; token permissions
are read-only and checkout does not persist credentials. No AI secret is needed.

The README badge now links to this workflow rather than a static passing image.
At the local review checkpoint, R1 was implemented but still awaiting its hosted
run. Local YAML/structure and quality checks were not treated as hosted success.
The completed GitHub Actions verification is recorded below.

Verification: a local TypeScript check parsed the YAML and asserted the triggers,
Node matrix, pinned actions, permissions, pnpm version, required gates and dynamic
badge. `pnpm install --frozen-lockfile --offline` passed without lockfile changes.
`pnpm audit --prod` reported one high-severity Zod advisory,
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), affecting
the core/contracts/server dependency paths. It reports a patched version of
4.6.6 or newer; this project currently uses Zod 3. No upgrade was attempted in
this phase. The advisory must be evaluated/remediated before public deployment;
an advisory CI step is not a security clearance. Local logs are
`/tmp/opencode/poster-phase1-install.log` and `poster-phase1-advisories.log`.

### README cleanup

The README now has one quick start and one copy of each reference section. It
uses the manifest's Node >=22.23.4 requirement, the measured 235-test inventory,
qualified milestone status and a prominent known-limitations/public-launch
warning. It accurately distinguishes local uploads from the stubbed upload API,
canonical parsing from broader import, native PDF from physical A4 sizing, and
implemented CI from an unverified hosted result.

The quick start explicitly loads `.env` and binds the API to loopback rather
than implying the bare scripts load it. Verification used `.env.example` (not
the private `.env`) with a spare loopback port: the documented Node/tsx startup
returned HTTP 200 and `status: ok` from `/api/health`. The listener was confirmed
as 127.0.0.1 and shut down after the check. The web dev command's Vite CLI was
also verified; the MIT/font notice and CI badge checks still pass. Existing
development servers were not stopped or rebound.

### Contract and configuration cleanup

`docs/contract.md` now distinguishes canonical producer requirements, restricted
parsing and broader HTML import. It removes stale milestone promises, documents
implemented edit/export/missing-asset behavior and the upload stub, and corrects
PDF units, full-document edit prompts, snapshot/cache state, timeout/isolation
claims and the actual reservation formula. A dated contract changelog records
documentation corrections without claiming schema/runtime changes.

`.env.example` now states that the server has in-memory state, uses a loopback
development origin/listener, warns about retry spend, and lists only consumed
settings. Unused export/upload/rate overrides are described as unsupported rather
than presented as working controls. The private `.env` was not changed.

Additional current behavior was verified while correcting stale text: default
text size is 32, unknown inline elements lose their contents, Arabic spacing has
no dedicated warning, and canonical letter spacing of 500 reparses as 200. The
last mismatch is an open Phase 3 round-trip/range issue, **not** fixed by this
documentation task. Font/color/PDF implementations were not replaced.

Verification: a local TypeScript check asserted all listed API routes, removal
of obsolete claims, valid local documentation links, consumed example settings,
the README HTML example and those parser behaviors. The CI/badge and MIT/font
checks also passed. **R3 current verdict: documentation corrected**; original
source-line citations above continue to describe the Phase 0 baseline at
`947349a`, not the newly formatted files. Security/product findings remain open.

### Phase 1 review checkpoint

Local implementation of the remaining Phase 1 tasks is complete. The changelog
and annotated baseline tag exist, licensing is MIT with the OFL notices retained,
the quality gates pass, the workflow/badge are real, and README/contract/example
configuration statements have been corrected. The final contract task also
corrects accounting comments; it does not change accounting behavior.

Final local verification:

- `pnpm install --frozen-lockfile --offline`: passed; no dependency/lockfile change.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`: passed.
- `pnpm test`: 235 passed (core 163, server 47, web 25).
- Documentation/workflow/MIT/font checks and the loopback startup smoke: passed.
- `pnpm audit --prod`: one high-severity Zod advisory, non-blocking only for the
  Phase 1 CI step; still a public-launch blocker.
- Git comparisons against `v0.1.0`: byte-exact HTML fixtures, screenshots and
  `pnpm-lock.yaml` unchanged. No dependency was added and `tools/` remains untouched.

Logs are `/tmp/opencode/poster-phase1-final-{build,typecheck,lint,format-check,tests}.log`.
Local verification still used Node 22.23.1, below the declared minimum; the
supported Node 22/latest matrix therefore required the hosted run recorded below.

At this checkpoint, "CI green on main" was not yet satisfied: commits and the tag
were local. The owner then authorized the push. Authentication, durable retry-safe
spend, ownership, renderer containment and the other security/product findings
are not fixed by Phase 1 and must not be marked green.

### Hosted CI verification — 9 November 2026

With the owner's approval, `main` and the annotated `v0.1.0` checkpoint tag were
pushed to origin. The tag still points to `3b7ef38`; it was not moved or replaced.

[GitHub Actions run 42573905144](https://github.com/mahdialsalkadi/ai-poster-editor/actions/runs/42573905144)
completed successfully for `2357f1a9bc9cda76c5f18cfa2e5ddc0c24cc1133` on main.
Both matrix jobs passed frozen installation, typecheck, lint, formatting,
Chromium/system dependency installation, all 235 tests and build:

- Node 22 resolved to **22.23.4**, satisfying the manifest's minimum.
- The latest-Node alias resolved to **27.0.0-alpha.0.0.0**. This is the actual
  tested prerelease, not a claim to have separately tested a latest-stable alias.

Both jobs still reported the known high-severity Zod advisory. The workflow
succeeded because that audit step is deliberately advisory in Phase 1; the
vulnerability was not fixed or waived for public deployment.

**R1 current verdict: remediated, hosted matrix verified. Phase 1 is complete.**
The badge now reflects a real successful hosted workflow. Logs are retained locally
at `/tmp/opencode/poster-phase1-github-ci-details.log`, in addition to GitHub's run
record. Stop for owner review before Phase 2; no deployment has been performed.
