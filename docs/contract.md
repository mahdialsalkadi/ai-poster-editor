# Design HTML contract (v1)

- **Status:** Normative for `@poster/core` v1
- **Document version:** `schemaVersion: 1`
- **Source of truth:** a single Design HTML document
- **Runtime representation:** `DesignDoc` (`packages/core/src/model.ts`)

This document defines the only HTML/CSS/SVG subset the editor, AI pipeline,
storage, and export worker may exchange. Anything outside the subset is either
rejected or dropped with a warning. The parser is deliberately stricter than a
browser: a document that renders in a browser is not necessarily a valid
Design HTML document.

## 1. Document shape

```html
<div
  class="artboard"
  data-width="1080px"
  data-height="1350px"
  style="background:#0f172a"
>
  <!-- layers in paint order: first is bottom, last is top -->
</div>
```

The `.artboard` element is required, and the input must be a Design HTML
**fragment**: a full HTML document is rejected because `<head>` metadata such as
`<meta>` or `<link>` is on the banned-tag list. The parser finds the first
element with class `artboard` inside that fragment.

| Attribute | Required | Meaning |
| --- | --- | --- |
| `class` | yes | must contain `artboard` |
| `data-width` | yes | artboard width, px |
| `data-height` | yes | artboard height, px |
| `style` | no | only `background` / `background-color`; other declarations warn |

Artboard dimensions must satisfy the limits in §8. `background` accepts a
solid color or a `linear-gradient(...)`.

## 2. Layer envelope

Every direct child of `.artboard` is a layer. Comments and whitespace are
ignored; other text is ignored with a warning.

```html
<div
  data-id="title"
  data-layer="Title"
  data-type="text"
  data-hidden="false"
  data-locked="false"
  style="position:absolute;left:80px;top:90px;width:920px;..."
>
  ...
</div>
```

| Attribute | Required | Rules |
| --- | --- | --- |
| `data-id` | yes | `^[A-Za-z][A-Za-z0-9_-]{0,63}$`, unique in the document |
| `data-layer` | no | display name, max 120 chars; default `Layer N` + warning |
| `data-type` | yes | `text`, `shape`, `image`, `svg` |
| `data-hidden` | no | exactly `"true"` hides the layer |
| `data-locked` | no | exactly `"true"` locks the layer |
| `data-prompt` | image only | generation prompt metadata |
| `style` | yes | must include `position:absolute`, `left`, `top`, `width` |

Unknown `data-*` attributes are dropped with a warning. Other unknown
attributes are not part of the contract.

### 2.1 Common style properties

| Property | Value | Notes |
| --- | --- | --- |
| `position` | `absolute` | required |
| `left`, `top` | px | may be negative, clamped to ±100000 |
| `width` | px | 1..10000 |
| `height` | px | required for shape/image/svg; forbidden for text |
| `transform` | `rotate(<n>deg)` | only rotation; normalized to `[0, 360)` |
| `opacity` | number | clamped to 0..1 |
| `background`, `background-color` | color or `linear-gradient(...)` | shape fill / artboard background |
| `border` | `<width>px <solid\|dashed\|dotted> <color>` | shape/image |
| `border-radius` | single px value | shape/image |
| `box-shadow` | `x y blur [spread] color` | shape/image; one shadow only |
| `text-shadow` | `x y blur color` | text; one shadow only, a fourth length is dropped with a warning |

Percentages are not allowed for geometry or font size. They are dropped with a
`PERCENTAGE_DROPPED` warning. `display`, `float`, margins, padding, `z-index`,
`overflow`, `filter`, `clip-path`, transitions, animations, and CSS variables
are not supported.

## 3. Text layers

```html
<div
  data-id="headline"
  data-layer="Headline"
  data-type="text"
  dir="rtl"
  style="position:absolute;left:80px;top:90px;width:920px;
         font-family:'Cairo';font-size:96px;font-weight:700;
         color:#ffffff;text-align:center;line-height:1.2;
         letter-spacing:0px"
>
  مرحبا <span style="color:#38bdf8">بالعالم</span>
</div>
```

Text height is automatic. A `height` declaration is dropped with a warning.

### 3.1 Inline content

Allowed inline nodes:

- text;
- `<br>`;
- `<span style="...">` with only `font-weight`, `font-style`,
  `text-decoration`, and `color`;
- `<b>`, `<strong>` (bold);
- `<i>`, `<em>` (italic);
- `<u>` (underline);
- `<p>` and `<div>` inside a text layer are treated as line breaks.

Unknown inline tags are unwrapped with an `UNKNOWN_TAG_DROPPED` warning.
Whitespace is normalized: CRLF becomes LF, then runs of spaces/tabs/newlines
collapse to one space. Leading/trailing spaces at the layer boundary are
trimmed. `br` at the start/end and consecutive `br` are collapsed.

### 3.2 Text style

| Property | Values | Default |
| --- | --- | --- |
| `font-family` | one of the 11 allowed fonts | `Inter` (LTR) / `Cairo` (RTL) |
| `font-size` | px, 1..1000 | 16 |
| `font-weight` | 100..900, multiples of 100; `normal`/`bold` | 400 |
| `font-style` | `normal`, `italic` | normal |
| `text-decoration` | `none`, `underline` | none |
| `color` | color | `#000000` |
| `text-align` | `left`, `center`, `right`, `justify`, `start`, `end` | `left` (`start`/`end` resolve by `dir`) |
| `line-height` | unitless number > 0, or `normal` | 1.2 |
| `letter-spacing` | px, -100..1000 | 0 |
| `text-transform` | `none`, `uppercase`, `lowercase`, `capitalize` | none |
| `text-shadow` | one shadow, no spread | none |

`dir` is `ltr` or `rtl`. If omitted and the text contains Arabic, the parser
infers `rtl` and emits `RTL_DIRECTION_INFERRED`. An explicit `dir` is preserved
by canonicalization.

If Arabic text is paired with a Latin-only font, the parser substitutes an
Arabic-capable font and emits `FONT_SCRIPT_MISMATCH`. `letter-spacing` on Arabic
text is accepted but warns because it can break cursive joining.

### 3.3 Allowed fonts

Latin: Poppins, Montserrat, Playfair Display, Bebas Neue, Inter, Lobster.
Arabic: Cairo, Tajawal, Noto Kufi Arabic, Amiri, IBM Plex Sans Arabic.

All are self-hosted Google Fonts under the SIL Open Font License. Only the first
family in a stack is considered, because Design HTML names one font and never
cascades: an unknown first family falls back to `Inter` (LTR) or `Cairo` (RTL)
with `FONT_FALLBACK`.

## 4. Shape layers

```html
<div
  data-id="card"
  data-layer="Card"
  data-type="shape"
  style="position:absolute;left:80px;top:300px;width:920px;height:420px;
         background:linear-gradient(135deg,#1e293b,#334155);
         border-radius:32px;box-shadow:0 20px 40px #00000066"
></div>
```

- `fill`: solid color or `linear-gradient(<angle>, <stop>, <stop>, ...)`.
- Gradient angles: `deg` or `to <side/corner>`; canonicalized to degrees.
- Stops: 2..6; each stop is a color with optional `%` position. Missing
  positions are distributed between neighbours; explicit stops are sorted by
  position.
- `border`: width > 0, style solid/dashed/dotted, color. All three styles are
  canonical and round-trip byte-identically.
- `border-radius`: one px value.
- `box-shadow`: x, y, blur (>=0), optional spread, color. `inset` is rejected
  with a warning.
- Height is required.

## 5. Image layers

```html
<img
  data-id="hero"
  data-layer="Hero"
  data-type="image"
  src="asset:hero_1"
  alt="Hero"
  data-prompt="a mountain at sunrise"
  style="position:absolute;left:80px;top:760px;width:920px;height:500px;
         object-fit:cover;object-position:50% 50%;border-radius:24px"
>
```

- `src` must match `^asset:[A-Za-z0-9_-]{1,64}$`. External URLs, `data:`, and
  `blob:` are rejected.
- `alt` is optional; `data-prompt` records generation provenance.
- `object-fit`: `cover`, `contain`, `fill`.
- `object-position`: one or two percentages/keywords (`left`, `center`,
  `right`, `top`, `bottom`), default `50% 50%`.
- Border, radius, and shadow follow shape rules.
- Height is required.

## 6. SVG layers

```html
<svg
  data-id="badge"
  data-layer="Badge"
  data-type="svg"
  viewBox="0 0 100 100"
  style="position:absolute;left:40px;top:40px;width:520px;height:520px"
>
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#38bdf8"></stop>
      <stop offset="100%" stop-color="#1d4ed8"></stop>
    </linearGradient>
  </defs>
  <title>Badge</title>
  <g fill="url(#sky)">
    <circle cx="50" cy="50" r="46"></circle>
    <path d="M20 50 L50 20 L80 50 L50 80 Z" fill="none" stroke="#ffffff"></path>
  </g>
</svg>
```

### 6.1 Allowed tags

`svg`, `g`, `defs`, `linearGradient`, `radialGradient`, `stop`, `path`, `rect`,
`circle`, `ellipse`, `line`, `polyline`, `polygon`, `title`, `desc`.

Forbidden (rejected): `script`, `style`, `foreignObject`, `use`, `image`, `a`,
`animate`, `animateMotion`, `animateTransform`, `set`, `filter`, `mask`,
`pattern`, `marker`, `clipPath`, `text`, `tspan`.

Unknown tags are dropped with an `SVG_LIMIT` warning.

### 6.2 Allowed attributes

`viewBox`, `preserveAspectRatio`, `gradientUnits`, `gradientTransform`,
`stop-color`, `stop-opacity`, `fill`, `fill-opacity`, `stroke`,
`stroke-opacity`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`,
`stroke-dasharray`, `stroke-dashoffset`, `d`, `x`, `y`, `x1`, `y1`, `x2`, `y2`,
`cx`, `cy`, `r`, `rx`, `ry`, `width`, `height`, `points`, `offset`, `opacity`,
`transform`, `id`, `fx`, `fy`, `fr`, `font-family`, `font-size`, `text-anchor`.
The three text attributes are accepted for fidelity only; `<text>` itself is
forbidden, so they are inert in v1.

`href`, `xlink:href`, `style`, and every `on*` attribute are rejected. Unknown
attributes are dropped with a warning. `id` must match
`^[A-Za-z][A-Za-z0-9_-]{0,63}$`.

### 6.3 Paint and references

- `fill`/`stroke` accept a color, `none`, or `url(#localId)`.
- `url(#id)` must name an `id` declared in the same SVG layer. An unresolved
  reference is **not** fatal: the paint attribute is dropped with an `SVG_LIMIT`
  warning and the element falls back to its default paint (black fill, no
  stroke). External URLs are rejected.
- `d` and `points` are limited to SVG path/number characters and a maximum
  length.
- Text content is allowed only inside `title`/`desc`; other text is dropped with
  a warning.

## 7. Canonical form

`canonicalizeDoc` is the normalization boundary. Two documents that represent
the same design must serialize to the same bytes.

Rules:

1. **Colors** become lowercase `#rrggbb` or `#rrggbbaa`. Eight keywords
   (`transparent`, `black`, `white`, `red`, `green`, `blue`, `gray`, `grey`),
   `rgb()`, `rgba()`, `hsl()`, and `hsla()` are accepted at parse time and converted.
   Every other CSS keyword (e.g. `rebeccapurple`) is dropped with
   `UNSUPPORTED_VALUE` and the fill falls back to transparent black.
2. **Numbers** are rounded to two decimals with a stable epsilon; `-0` becomes
   `0`. Angles are normalized to `[0, 360)`.
3. **Geometry** is clamped to the limits. `width`/`height` are at least 1.
4. **Gradients** keep at most 6 stops, sort by position, and require at least 2.
5. **Fonts** are resolved to an allowed family; Arabic text without an
   Arabic-capable font falls back to Cairo.
6. **Text direction** is preserved; the parser infers it only when absent.
7. **Defaults** are explicit in the serialized output where the format needs
   them (e.g. `text-align:left`, `line-height:1.2`).
8. **Ordering** is deterministic: layer array order, fixed CSS property order,
   SVG attributes sorted by name.
9. **Round trip**: `parse(serialize(doc))` equals `canonicalizeDoc(doc)` and
   `serialize(parse(serialize(doc)))` is byte-identical.

## 8. Limits

All limits live in `packages/core/src/limits.ts`.

| Area | Limit |
| --- | --- |
| Design HTML | 200 KiB |
| Layers | 200 |
| Artboard side | 100..5000 px |
| Artboard pixels | 25,000,000 |
| Layer id | 64 chars |
| Layer name | 120 chars |
| Text per layer | 10,000 codepoints |
| Inline nodes per layer | 1,000 |
| Font size | 1..1000 px |
| Letter spacing | -100..1000 px |
| Style declarations | 64 per layer |
| Style attribute | 8 KiB |
| Gradient stops | 2..6 |
| SVG depth | 16 |
| SVG nodes | 2,000 |
| SVG path | 20,000 chars |
| SVG attributes/node | 32 |
| SVG viewBox | 200 chars |
| Assets | 20 per document |
| Asset bytes | 10 MiB |
| Asset dimension | 8000 px |
| Asset pixels | 40 MP |
| Total asset pixels | 80 MP |
| Export | 40 MP, 40 MiB, 15 s, queue 20, concurrency 2 |
| AI request | 512 KiB body, 128 KiB model output, 60 layers per generation |
| AI call | 60 s timeout, 1 retry, 16,000 output tokens |
| AI volume | 5 generations/min/IP (20/hour/session), 10 edits/min/IP |
| Export/upload volume | 10 exports/min/IP, 20 uploads/min/IP |
| History | 100 undo steps |
| Snapshots | 20 per project |

Exceeding a hard limit throws `LimitExceededError` (or a `DesignError` with
`LIMIT_EXCEEDED`). Values that can be safely clamped are clamped and produce a
`NUMBER_CLAMPED` warning.

## 9. Security boundary

Rejected with `SecurityViolationError`:

- banned HTML tags: `script`, `style`, `link`, `iframe`, `form`, `input`,
  `button`, `textarea`, `select`, `option`, `object`, `embed`, `meta`, `base`,
  `template`, `video`, `audio`, `source`, `track`, `math`, `foreignObject`,
  `use`, `image`;
- every `on*` event attribute;
- `href`, `xlink:href`, `srcset`, `action`, `formaction`, `poster`;
- any `src` that is not an `asset:` reference, including protocol-relative
  `//host/path` and `data:`/`blob:` URLs;
- CSS `url(...)`, `@import`, `expression(...)`, `javascript:` in any spelling,
  including escaped forms (`\75rl(`, `u\72l(`) and mixed case (`URL(`);
- CSS `behavior`, `-moz-binding`;
- SVG scripts, external references, event attributes, `href`, `style`;
- duplicate layer ids;
- invalid ids, invalid `asset:` ids, invalid SVG ids.

The parser never executes scripts, loads external resources, or writes to the
DOM. It is safe to run on untrusted AI output in the server process. The web
renderer must still sanitize/validate before rendering; it should render from
`DesignDoc`, not by injecting Design HTML into `innerHTML`.

## 10. Warnings

Warnings are non-fatal. Each has `{ code, message, path, layerId?, severity }`.
Duplicate layer ids are fatal (`DUPLICATE_ID`), not warnings. The table lists the
codes the v1 core actually emits; `ASSET_UNRESOLVED` is reserved for the export
worker in milestone 6 and is not emitted yet.

| Code | Meaning |
| --- | --- |
| `UNSUPPORTED_PROPERTY` | declaration/attribute is not part of the contract |
| `UNSUPPORTED_VALUE` | value is malformed or unsupported |
| `PERCENTAGE_DROPPED` | percentage used where px is required |
| `FONT_FALLBACK` | unknown font replaced |
| `FONT_SCRIPT_MISMATCH` | font lacks Arabic coverage |
| `SVG_LIMIT` | SVG tag/attribute/node issue |
| `GRADIENT_LIMIT` | too many stops, truncated |
| `NUMBER_CLAMPED` | numeric value clamped |
| `MISSING_ATTRIBUTE` | required metadata absent, default used |
| `UNKNOWN_TAG_DROPPED` | unsupported HTML/inline tag dropped |
| `RTL_DIRECTION_INFERRED` | Arabic detected, `dir="rtl"` inferred |
| `MERGE_*` | merge-specific outcomes |

## 11. Merge contract

AI edits are patches, not full replacements.

`mergeDesignDoc(base, patch, options)`:

- canonicalizes both inputs first;
- preserves base layers missing from the patch;
- replaces selected existing layers in place, keeping z-order;
- rejects a type change for an existing id (`MERGE_TYPE_CHANGE_IGNORED`);
- ignores layers outside `selectedLayerIds` (`MERGE_IGNORED_UNSELECTED`);
- appends new layers only when `allowNewLayers` is true
  (`MERGE_NEW_LAYER`), otherwise ignores them;
- ignores artboard size/background unless `allowArtboardChanges` is true
  (`MERGE_ARTBOARD_CHANGE_IGNORED`);
- reports duplicate patch ids and keeps the first (`MERGE_DUPLICATE_ID`).

The result is canonicalized again. Invalid patch input throws before merging.

### 11.1 Selection-scoped edits

`mergeScopedEdit(baseDoc, aiOutputHtml, selectedLayerIds)` is the path the AI
editor uses. For a scoped edit the model never receives the whole document: it
receives only the selected layers plus the artboard size, and it must answer
with a full `.artboard` wrapper carrying the same `data-width` and `data-height`
and containing only the layers it returns. That wrapper is what makes the
answer parseable by `parseDesignHtml` before any merge happens.

Rules:

- The AI output is parsed and validated first. A security violation, a limit
  breach or an invalid document throws before the base document is touched.
- Unselected layers keep their content, geometry and z-order. A returned layer
  outside the selection is ignored with `MERGE_IGNORED_UNSELECTED`.
- A returned layer whose `data-id` matches a selected layer replaces it in
  place, so it keeps its index and its paint order.
- A selected layer missing from the output is kept. Scoped edits never delete
  layers.
- A returned layer with an unknown id is a new layer. It is inserted directly
  above the highest selected layer, in output order, and reports
  `MERGE_NEW_LAYER`. When the selection is empty, new layers are appended at
  the end.
- A type change on an existing id is refused with `MERGE_TYPE_CHANGE_IGNORED`.
- A changed `width` or `height` is refused with
  `MERGE_ARTBOARD_CHANGE_IGNORED`; the background always comes from the base
  document.
- New ids are re-minted (`<id>_2`, `<id>_3`, ...) on collision. The parser
  already rejects duplicate ids inside one output, so this guard is defensive.
- Parse warnings are carried through, and the merged document is canonicalized
  again before it is returned.

`mergeDesignDoc` remains available for whole-design patches and for the
`/api/design/merge` route. `POST /api/ai/edit` will expose the scoped path in
milestone 5.

## 12. API boundary

The contracts package defines request/response schemas and error envelopes:

- `POST /api/design/validate` — Design HTML -> `{ doc, warnings }`
- `POST /api/design/serialize` — `{ doc }` -> canonical Design HTML
- `POST /api/design/merge` — base + patch + selection -> merged document
- `POST /api/ai/generate` — prompt -> Design HTML
- `POST /api/ai/edit` — instruction + selection -> patch -> merge
- `POST /api/assets` — image upload -> `asset:<id>`
- `POST /api/export` — `{ doc, assets }` -> PNG/JPEG at 1x/2x/3x, PDF at
  artboard size, or standalone HTML (milestone 6; returns
  `UNSUPPORTED_FEATURE` today)
- `GET /api/export/limits` — the export limits below

Every non-2xx response uses the error envelope:

```json
{
  "error": {
    "code": "INVALID_DOC",
    "message": "Design document failed validation",
    "path": "document",
    "requestId": "req_..."
  }
}
```

### 12.1 Export contract

> **Milestone 6 — not implemented yet.** `packages/contracts/src/export.ts`
> still holds the M0 placeholder (`designHtml`, `scale` 0.1..4, no HTML
> output); this section is the target the export worker must satisfy, and the
> placeholder schema is replaced rather than extended. Today the route parses
> its body for diagnostics and then throws `UNSUPPORTED_FEATURE`.

**Input.** The client sends the canonical `DesignDoc`, never Design HTML: the
editor already holds the document, and a serialize/reparse cycle would let a
lossy round-trip change the design on the way to the renderer. Alongside the
document the client sends **only the image bytes the document references** —
a document with 3 images on a 400-layer artboard uploads 3 files, not 400
layers of HTML and not the asset library.

The request is `multipart/form-data`:

- `options` — `{ format: 'png' | 'jpeg' | 'pdf' | 'html', scale: 1 | 2 | 3,
  quality?, idempotencyKey? }`; `scale` is ignored for `pdf` and `html`.
- `doc` — the `DesignDoc` JSON.
- one binary part per referenced asset, named by its `asset:` id.

A referenced asset with no part fails `ASSET_UNRESOLVED`; a part for an
unreferenced id is ignored. The document is canonicalized and validated
before any asset byte is read. Repeated requests with the same
`idempotencyKey` return the stored result instead of rendering again.

**Asset re-validation.** Supplied bytes are never trusted. For each asset the
server sniffs the real type with `file-type` (`image/png`, `image/jpeg` or
`image/webp` only; the declared MIME type is ignored), compares the header
dimensions and pixel count with the asset limit, and decodes and re-encodes
the image with `sharp`. A failure is `INVALID_DOC` with `path: assets.<id>`.
Only the re-encoded buffer reaches the renderer, so a polyglot file or a
decompression bomb is rejected before rendering starts.

**Serialization.** `serializeForExport(doc, assets)` produces one
self-contained HTML document: hidden layers are omitted, every `asset:<id>`
becomes an inline `data:` URI of the re-encoded bytes, and the allowed fonts
are embedded as `@font-face` rules with inline woff2 data URIs. The result
has no external reference of any kind and is the only thing the renderer
receives — never the editor DOM, never the asset URLs.

**Rendering.** Playwright renders in an isolated context: strict CSP
(`default-src 'none'`, inline styles/fonts/images only), no network, no
`--no-sandbox` override, one fresh context per request, and the worker process
is killed after `LIMITS.export.timeoutMs`. The page is the serialized HTML
above; the renderer waits for `document.fonts.ready` before capturing.

**Output.**

- `png` / `jpeg`: exactly artboard size x `scale` in integer pixels, so 1x, 2x
  and 3x are reproducible. `jpeg` flattens onto the artboard background and
  honours `quality` (default 0.92).
- `pdf`: one page whose size equals the artboard size in points, no margins
  and no scaling; the page is rendered at 2x and placed at 1x so text stays
  sharp.
- `html`: the `serializeForExport` document itself, served as
  `text/html; charset=utf-8` for download. It is a self-contained copy, not a
  re-importable design.

**Limits and errors** (§8): 40 MP of output, 40 MiB response, 15 s, queue 20,
concurrency 2. Oversize output is `LIMIT_EXCEEDED`, a worker crash or timeout
is `EXPORT_FAILED`, a missing asset is `ASSET_UNRESOLVED`, malformed asset
bytes are `INVALID_DOC`, and a disabled worker is `UNSUPPORTED_FEATURE`.

### 12.2 AI contract

> **Milestone 5 — not implemented yet.** Only `AI_PROVIDER=local` works today:
> it returns the deterministic `local-template-v1` design and never calls a
> model. `POST /api/ai/edit` returns `UNSUPPORTED_FEATURE`. The prompt files in
> `prompts/` already carry the untrusted-data rules below; the provider that
> consumes them lands in this milestone.

**Provider boundary.** The server talks to one `AiProvider` interface
(`generateDesign`, `editDesign`) selected by `AI_PROVIDER`. Provider keys stay
in the server environment (`OPENAI_API_KEY`) and never reach the browser, the
prompt, a log line or an error message. `usage.model` always names the model
that actually ran, so a local template is never reported as a hosted model.

**Untrusted data.** Nothing the model sees is trusted, and nothing the model
returns is trusted either:

- The design is embedded in the prompt inside
  `<untrusted_design_data>...</untrusted_design_data>`, and the system prompt
  states that the block is data, that any instruction inside it must be
  ignored, and that only the instruction field is authoritative.
- The literal `</untrusted_design_data` sequence is neutralized by
  `wrapUntrustedData` in serialized text before wrapping, so layer text cannot
  close the block early and the opening tag cannot nest a second block.
- The instruction is plain text capped at 4,000 characters and sent in its own
  field; it is never concatenated into the data block.
- Model output is parsed by `parseDesignHtml` through the full security
  boundary of §9 and then canonicalized. A model that emits a script, an
  external URL or a forbidden tag produces `AI_INVALID_OUTPUT`, never a
  partially applied edit.

**One retry.** Invalid output is retried once with the validation error
appended to the prompt (`LIMITS.ai.retries`), then fails with
`AI_INVALID_OUTPUT`. There is no repair loop and no hidden second model. The
call is bounded by `LIMITS.ai.timeoutMs`, `LIMITS.ai.maxRequestBytes`,
`LIMITS.ai.maxOutputBytes`, `LIMITS.ai.maxOutputTokens` and
`LIMITS.ai.maxLayers`.

**Snapshot before edit.** Before an edit is applied, the server stores the
current canonical document as a snapshot keyed by project id
(`LIMITS.snapshots.maxPerProject`, oldest dropped first). The apply response
carries the snapshot id, and restoring it is a plain document write, so a bad
AI edit is always reversible without asking the model again. Snapshots are
read back through `validateDesignDoc`.

**Daily spend cap.** Spend is accounted per server per UTC day. Before a call
the server reserves the estimated cost (prompt tokens x provider price); if
`spent + reserved` would exceed `AI_DAILY_SPEND_CAP_USD`, the request fails
with `SPEND_CAP_EXCEEDED` (HTTP 402) **before** the provider is called. After
the call the reservation is settled to the actual `usage.costUsd`. Reserving
first is what stops concurrent requests from racing past the cap. Per-IP and
per-session limits (`LIMITS.rateLimit`) are checked earlier and answer
`RATE_LIMITED`. The cap value is deployment configuration, not code.

**Paths.** Generation returns Design HTML plus `usage`. The edit path returns
a patch that is merged with `mergeScopedEdit` (§11.1). Neither path can change
the artboard size, and a scoped edit never deletes a selected layer.

## 13. Versioning

`schemaVersion` is `1`. A breaking change to the document shape, canonical form,
or security boundary requires a new version and a migration function. Additive
warnings and optional metadata do not. Design HTML carries no version field;
the version lives on `DesignDoc`, and `canonicalizeDoc` rejects a document whose
`schemaVersion` is not `1` with `UNSUPPORTED_FEATURE`.

## 14. Reference implementation

- `packages/core/src/parse.ts` — parse5 whitelist parser
- `packages/core/src/serialize.ts` — canonical serializer
- `packages/core/src/canonicalize.ts` — normalization
- `packages/core/src/style.ts` — CSS subset
- `packages/core/src/svg.ts` — SVG allow-list
- `packages/core/src/schema.ts` — runtime Zod schema
- `packages/core/src/merge.ts` — AI patch merge
- `packages/core/src/merge-scoped.ts` — selection-scoped AI merge
- `packages/core/src/untrusted.ts` — prompt-side untrusted-data wrapper
- `packages/core/src/css-guard.ts` — CSS escape decoding and value guards
- `packages/core/src/text.ts` — canonical inline text
- `packages/core/src/fonts.ts` — font allow-list and script fallback
- `packages/core/src/color.ts` — color normalization
- `packages/core/src/numbers.ts` — quantization and angle normalization
- `packages/core/src/limits.ts` — every limit above
- `packages/core/test/` — `core`, `security`, `limits`, `properties` (fast-check),
  `golden`, `merge-scoped`, `svg-casing` and `perf` suites
