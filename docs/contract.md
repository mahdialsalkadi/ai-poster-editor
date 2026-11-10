# Design HTML contract (v1)

- **Status:** Canonical schema-v1 contract with current implementation notes
- **Document version:** `schemaVersion: 1`
- **Source of truth:** a single Design HTML document
- **Runtime representation:** `DesignDoc` (`packages/core/src/model.ts`)

This document defines the canonical HTML/CSS/SVG form exchanged by the AI
pipeline and core, plus the model used by storage, rendering and export. It
separates producer requirements from parser/import compatibility behavior.
Unsupported input can be rejected, dropped, approximated or reported with a
warning; acceptance does not mean browser-equivalent rendering.

The current application is **not approved for public deployment**. Authentication,
ownership, spending and export-isolation gaps remain open in [audit.md](audit.md).
The implementation notes below describe those gaps, not a completed security
guarantee. The documentation changes do not change `schemaVersion` or runtime code.

## 1. Document shape

```html
<div class="artboard" data-width="1080px" data-height="1350px" style="background:#0f172a">
  <!-- layers in paint order: first is bottom, last is top -->
</div>
```

Canonical output is a Design HTML **fragment** with exactly one `.artboard`.
`parseDesignHtml` requires exactly one such element and scans the whole input for
banned tags/attributes. Typical full exported documents are rejected because
their `<meta>` and `<style>` elements are banned; an outer HTML wrapper alone is
not the rejection rule. Use `importDesignDocument` for full-document import.

| Attribute     | Required | Meaning                                                                |
| ------------- | -------- | ---------------------------------------------------------------------- |
| `class`       | yes      | must contain `artboard`                                                |
| `data-width`  | yes      | artboard width, positive number or px; canonical output uses px        |
| `data-height` | yes      | artboard height, positive number or px; canonical output uses px       |
| `style`       | no       | canonical background; CSS size compatibility fallbacks described below |

Artboard dimensions must satisfy the limits in §8. `background` accepts a
solid color or a `linear-gradient(...)`.

`parseDesignHtml` also accepts artboard CSS `width`/`height` when the data
attributes are absent, but still requires `px` (or the special unitless zero,
which fails the artboard minimum). Positive bare numeric data attributes are
not accepted by this parser yet. Canonical serialization always emits `px`.

### 1.1 Broader HTML import is a separate boundary

The editor calls `importDesignDocument`, not the restricted parser directly,
when importing files. This path accepts up to 40 MiB of source HTML, extracts
stylesheet rules/variables without executing scripts, identifies an artboard or
compatible container, and converts a subset of nested HTML/CSS into positioned
layers. It approximates normal flow, Flexbox, Grid, lists, tables and compound
shape/text elements; it can convert some CSS polygons/triangles into SVG.

It resolves a wider set of lengths, can infer missing dimensions, and can
extract inline image data into assets. Metadata/scripts and unsupported elements
are discarded rather than receiving the restricted parser's identical rejection
behavior. External resources are not fetched by the importer. The generated
fragment is passed to `parseDesignHtml`; image bytes still require independent
type/dimension validation in the browser and on export. Only PNG/JPEG/WebP are
supported by the app's image-upload/export policy.

`{ strict: true }` requires an explicit `.artboard` and `px` artboard dimensions;
it does not turn the importer into a full browser or remove its conversion step.
Broader import is lossy and has different input limits from canonical interchange.

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

| Attribute     | Required   | Rules                                                    |
| ------------- | ---------- | -------------------------------------------------------- |
| `data-id`     | yes        | `^[A-Za-z][A-Za-z0-9_-]{0,63}$`, unique in the document  |
| `data-layer`  | no         | display name, max 120 chars; default `Layer N`           |
| `data-type`   | yes        | `text`, `shape`, `image`, `svg`                          |
| `data-hidden` | no         | exactly `"true"` hides the layer                         |
| `data-locked` | no         | exactly `"true"` locks the layer                         |
| `data-prompt` | image only | generation prompt metadata                               |
| `style`       | yes        | must include `position:absolute`, `left`, `top`, `width` |

The table specifies what canonical producers must emit. The parser also accepts
`id`/`data-name` aliases, generates a missing ID, truncates IDs to 64 characters,
and infers layer type from the element/content when `data-type` is absent.
Duplicate resulting IDs are fatal. Canonical validation enforces the ID pattern;
parsing alone is not a substitute for `validateDesignDoc` on untrusted model data.
Missing left/top coordinates currently default to zero. Unknown metadata is not
preserved, but not every ignored attribute produces a warning.

### 2.1 Common style properties

| Property                         | Value                                       | Notes                                                            |
| -------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| `position`                       | `absolute`                                  | required                                                         |
| `left`, `top`                    | px                                          | may be negative, clamped to ±100000                              |
| `width`                          | px                                          | 1..10000                                                         |
| `height`                         | px                                          | required for shape/image/svg; forbidden for text                 |
| `transform`                      | `rotate(<n>deg)`                            | only rotation; normalized to `[0, 360)`                          |
| `opacity`                        | number                                      | clamped to 0..1                                                  |
| `background`, `background-color` | color or `linear-gradient(...)`             | shape fill / artboard background                                 |
| `border`                         | `<width>px <solid\|dashed\|dotted> <color>` | shape/image                                                      |
| `border-radius`                  | single px value                             | shape/image                                                      |
| `box-shadow`                     | `x y blur [spread] color`                   | shape/image; one shadow only                                     |
| `text-shadow`                    | `x y blur color`                            | text; one shadow only, a fourth length is dropped with a warning |

Canonical lengths are px. Layer length parsing also converts `rem`/`em`/`pt`
to px; this is not inherited browser layout. Percentage geometry is dropped
with `PERCENTAGE_DROPPED` and can then fail required-width/height checks.
Font-size percentages are unsupported. Rotation parsing accepts deg/rad/turn/grad
and keeps a rotation, not arbitrary transform composition.

`display`, float, layout margins/padding, z-index, overflow, filters, clipping,
transitions, animations and CSS variables are not represented in `DesignDoc`.
Some are recognized and silently omitted by the restricted parser; broader
import (§1.1) can approximate selected layouts before producing canonical layers.

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

Text height is automatic. An input `height` is not retained on the text layer;
the current parser does not guarantee a warning when omitting it.

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

Compatibility input also accepts `ins` (underline), `mark` (bold), `cite`/`q`
(italic), and the content of `small`, `code`, `a` without href, `label`, `sub`,
`sup` and `time`. These normalize to the same text/span/break model; subscript,
superscript and other browser-specific inline layout are not retained.
Unknown inline elements and their contents are dropped with
`UNKNOWN_TAG_DROPPED`, not generally unwrapped by `parseDesignHtml`.
Whitespace is normalized: CRLF becomes LF, then runs of spaces/tabs/newlines
collapse to one space. Leading/trailing spaces at the layer boundary are
trimmed. Leading/trailing `br` are removed; up to two consecutive internal `br`
are retained, preserving one blank line. Longer runs are capped at two.

### 3.2 Text style

| Property          | Values                                               | Default                                 |
| ----------------- | ---------------------------------------------------- | --------------------------------------- |
| `font-family`     | one of the 11 allowed fonts                          | `Inter` (LTR) / `Cairo` (RTL)           |
| `font-size`       | px, 1..1000                                          | 32                                      |
| `font-weight`     | 100..900, multiples of 100; `normal`/`bold`          | 400                                     |
| `font-style`      | `normal`, `italic`                                   | normal                                  |
| `text-decoration` | `none`, `underline`                                  | none                                    |
| `color`           | color                                                | `#000000`                               |
| `text-align`      | `left`, `center`, `right`, `justify`, `start`, `end` | `left` (`start`/`end` resolve by `dir`) |
| `line-height`     | unitless multiplier, clamped to 0.5..5, or `normal`  | 1.2                                     |
| `letter-spacing`  | px, -100..1000                                       | 0                                       |
| `text-transform`  | `none`, `uppercase`, `lowercase`, `capitalize`       | none                                    |
| `text-shadow`     | one shadow, no spread                                | none                                    |

`dir` is `ltr` or `rtl`. If omitted and the text contains Arabic, the parser
infers `rtl` and emits `RTL_DIRECTION_INFERRED`. An explicit `dir` is preserved
by canonicalization.

If Arabic text is paired with a Latin-only font, the parser substitutes an
Arabic-capable font and emits `FONT_SCRIPT_MISMATCH`. Arabic content or RTL
direction forces zero letter spacing, with `ARABIC_LETTER_SPACING_DROPPED` when
parsing a nonzero value. The editor disables the spacing field for those layers.

The parser also accepts keyword font sizes and converts supported relative
lengths to px. It normalizes percentage/px line height to a multiplier. Parser and
canonicalizer share line-height 0.5..5 and Latin letter-spacing -100..1000 limits.

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

Compatibility parsing takes the first radius from multi-corner shorthand,
converts a percentage radius using the box size, and reduces border longhands,
directional borders or an outline to one uniform border. Some noncanonical border
styles become solid. Only the first shadow is retained; inset shadows are dropped.
Repeating gradients lose repetition, and radial/conic CSS gradients can be
approximated as linear gradients. These are lossy conversions, not new canonical
fill types. Producers should use explicit canonical values instead.

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
/>
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

1. **Colors** become lowercase `#rrggbb` or `#rrggbbaa`. The expanded named-color
   table in `packages/core/src/color.ts` includes `orange`, `gold`, `navy` and
   `rebeccapurple`; supported hex, `rgb()`/`rgba()` and `hsl()`/`hsla()` input is
   converted too. Unsupported text colors warn and use opaque `#000000`;
   unsupported shape fills warn and use transparent black. Unsupported paint
   emits `UNSUPPORTED_COLOR` and triggers the AI's one retry (manual imports keep
   the safe fallbacks). Direct invalid model colors fail canonicalization.
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

Rule 9 is tested for generated supported-domain documents, fixtures and text
spacing boundaries. Parser and canonicalizer share the same limits. Arabic or
RTL text always uses zero letter spacing; parsing nonzero spacing emits
`ARABIC_LETTER_SPACING_DROPPED`. Canonicalization can clamp without parser warnings.

## 8. Limits

Configured limits live in `packages/core/src/limits.ts`. The table includes
intended ceilings; enforcement gaps are called out below rather than treating
every constant as a working guard.

| Area                   | Limit                                                        |
| ---------------------- | ------------------------------------------------------------ |
| Design HTML            | 200 KiB                                                      |
| Layers                 | 200                                                          |
| Artboard side          | 100..5000 px                                                 |
| Artboard pixels        | 25,000,000                                                   |
| Layer id               | 64 chars                                                     |
| Layer name             | 120 chars                                                    |
| Text per layer         | 10,000 codepoints                                            |
| Inline nodes per layer | 1,000                                                        |
| Font size              | 1..1000 px                                                   |
| Letter spacing         | -100..1000 px                                                |
| Style declarations     | 64 per layer                                                 |
| Style attribute        | 8 KiB                                                        |
| HTML nesting           | 64 levels, including document envelope                       |
| Gradient stops         | 2..6                                                         |
| SVG depth              | 16                                                           |
| SVG nodes              | 2,000                                                        |
| SVG path               | 20,000 chars                                                 |
| SVG attributes/node    | 32                                                           |
| SVG viewBox            | 200 chars                                                    |
| Assets                 | 20 per document                                              |
| Asset bytes            | 10 MiB                                                       |
| Asset dimension        | 8000 px                                                      |
| Asset pixels           | 40 MP                                                        |
| Total asset pixels     | 80 MP                                                        |
| Export                 | 40 MP, 40 MiB, 15 s, queue 20, concurrency 2                 |
| AI request             | 512 KiB body, 128 KiB model output, 60 layers per generation |
| AI call                | 60 s timeout, 1 retry, 16,000 output tokens                  |
| AI volume              | 5 generations/min/IP (20/hour/session), 10 edits/min/IP      |
| Export/upload volume   | 10 exports/min/IP, 20 uploads/min/IP                         |
| History                | 100 undo steps                                               |
| Snapshots              | 20 browser-local entries                                     |

Enforced hard limits throw `LimitExceededError` (or a `DesignError` with
`LIMIT_EXCEEDED`). Parser clamping may produce `NUMBER_CLAMPED`; model
canonicalization can clamp silently. Current qualifications include:

- The Fastify JSON body limit is 1 MiB, not a route-specific 512 KiB AI-body
  ceiling. AI prompt/output and parsed Design HTML checks occur separately.
- Style attributes enforce 8 KiB of UTF-8 before CSS parsing. Export preflights
  every image header against side/per-image/aggregate pixel limits before decoding.
- Export routes enforce principal-plus-IP rate limits. Uploads happen in the
  browser and are revalidated on export; the standalone upload route is unsupported.
- The worker's 15-second total deadline includes browser launch and rendering,
  but not queue wait or asset preparation. Queue admission bounds both preparation
  and rendering; queue-full is `RATE_LIMITED` (HTTP 429), not a size error.
- Snapshots are browser-local with an atomic 20-entry cap, not server projects.

## 9. Security boundary

The restricted HTML/SVG parser rejects these security constructs:

- banned HTML tags: `script`, `style`, `link`, `iframe`, `form`, `input`,
  `button`, `textarea`, `select`, `option`, `object`, `embed`, `meta`, `base`,
  `template`, `video`, `audio`, `source`, `track`, `math`, `foreignObject`,
  `use`, `image`, `applet`;
- every `on*` event attribute;
- `href`, `xlink:href`, `srcset`, `action`, `formaction`, `poster`;
- any `src` that is not an `asset:` reference, including protocol-relative
  `//host/path` and `data:`/`blob:` URLs;
- CSS `url(...)`, `@import`, `expression(...)`, `javascript:` in any spelling,
  including escaped forms (`\75rl(`, `u\72l(`) and mixed case (`URL(`);
- CSS `behavior`, `-moz-binding`;
- SVG scripts, external references, event attributes, `href`, `style`;
- invalid `asset:` references and invalid SVG IDs.

Duplicate layer IDs fail with `DUPLICATE_ID`, not `SecurityViolationError`.
Canonical model validation enforces layer-ID syntax; the HTML parser's metadata
compatibility behavior is described in §2. Errors for malformed IDs and other
validation failures are not all security-violation errors.

The parser does not execute scripts, load resources or write to the DOM. This
does not prove resource isolation or eliminate the need to validate parsed model
data, apply API limits and address dependency advisories. The web renders React
children and validated SVG nodes from `DesignDoc`; it does not inject Design HTML
with `innerHTML`. The editor shell now carries the strict build-time app CSP
(`default-src 'none'`, `script-src 'self'`, no inline scripts, same-origin
`connect-src`) from `apps/web/src/csp.ts`, delivered through a Vite build-only
plugin; `frame-ancestors 'none'` is an HTTP header from the reverse proxy. Public
deployment additionally requires the container worker, origin/proxy policy and
rate limits described in §12 and `docs/security.md`. The importer (§1.1) has a
different dropping/conversion policy from this parser.

## 10. Warnings

Warnings are non-fatal. Each has `{ code, message, path, layerId?, severity }`.
Duplicate layer IDs are fatal (`DUPLICATE_ID`), not warnings. The table lists
core warning codes. `ASSET_UNRESOLVED` is an implemented export error for a missing
referenced image, not a parser warning or a future milestone placeholder.

| Code                     | Meaning                                           |
| ------------------------ | ------------------------------------------------- |
| `UNSUPPORTED_PROPERTY`   | declaration/attribute is not part of the contract |
| `UNSUPPORTED_VALUE`      | value is malformed or unsupported                 |
| `PERCENTAGE_DROPPED`     | percentage used where px is required              |
| `FONT_FALLBACK`          | unknown font replaced                             |
| `FONT_SCRIPT_MISMATCH`   | font lacks Arabic coverage                        |
| `SVG_LIMIT`              | SVG tag/attribute/node issue                      |
| `GRADIENT_LIMIT`         | too many stops, truncated                         |
| `NUMBER_CLAMPED`         | numeric value clamped                             |
| `MISSING_ATTRIBUTE`      | required metadata absent, default used            |
| `UNKNOWN_TAG_DROPPED`    | unsupported HTML/inline tag dropped               |
| `RTL_DIRECTION_INFERRED` | Arabic detected, `dir="rtl"` inferred             |
| `MERGE_*`                | merge-specific outcomes                           |

## 11. Merge contract

AI edits are patches, not full replacements.

`mergeDesignDoc(base, patch, options)`:

- canonicalizes both inputs first;
- preserves base layers missing from the patch;
- replaces selected existing layers in place, keeping z-order;
- rejects a type change for an existing id (`MERGE_TYPE_CHANGE_IGNORED`);
- ignores layers outside `selectedLayerIds` (`MERGE_IGNORED_UNSELECTED`);
- appends new layers only when `allowNewLayers` is true
  (`MERGE_NEW_LAYER`), otherwise ignores them with `MERGE_IGNORED_UNSELECTED`;
- ignores artboard size/background unless `allowArtboardChanges` is true
  (`MERGE_ARTBOARD_CHANGE_IGNORED`);
- rejects duplicate input IDs during canonicalization. Its later
  `MERGE_DUPLICATE_ID` guard is defensive, not a promise to accept malformed patches.

The result is canonicalized again. Invalid patch input throws before merging.

### 11.1 Selection-scoped edits

`mergeScopedEdit(baseDoc, aiOutputHtml, selectedLayerIds)` is the path used by
`POST /api/ai/edit`. The current service sends the whole serialized base document
inside an untrusted-data block, with selected IDs supplied separately. Scope is
enforced at merge time; it is not prompt-data minimization. The model must answer
with a full `.artboard` wrapper carrying the same `data-width` and `data-height`
and only the changed/allowed layers. The wrapper makes the answer parseable
before merging.

Rules:

- The AI output is parsed first and the merged model is canonicalized before
  application. Rejected input never partially writes back to the base document.
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
- New layers keep their unique ids. Duplicate ids inside one patch fail parsing;
  an id already present in the base is an existing-layer edit, never a new layer.
- Parse warnings are carried through, and the merged document is canonicalized
  again before it is returned.

`mergeDesignDoc` remains available for whole-design patches and for the
`/api/design/merge` route. The AI service rejects unknown IDs before merging when
`allowNewLayers` is false; the lower-level scoped merge function itself accepts
new layers as described above.

## 12. API boundary

The contracts package defines request/response schemas and error envelopes:

- `POST /api/design/validate` — Design HTML -> `{ doc, warnings }`
- `POST /api/design/serialize` — `{ doc }` -> canonical Design HTML
- `POST /api/design/merge` — base + patch + selection -> merged document
- `POST /api/ai/generate` — prompt -> Design HTML
- `POST /api/ai/edit` — instruction + selection -> patch -> merge
- `POST /api/auth/login` — email/password -> server-set HttpOnly session cookie
- `POST /api/auth/logout` — clear the local session cookie
- `GET /api/auth/me` — current authenticated principal
- `POST /api/assets` — currently a stub returning `UNSUPPORTED_FEATURE` (HTTP 422);
  the editor uploads/stores images locally instead
- `GET /api/assets/limits` — supported image types and per-image limits
- `POST /api/export` — implemented multipart `options` + `doc` + image parts ->
  PNG/JPEG at 1x/2x/3x, native PDF or standalone HTML
- `GET /api/export/limits` — the export limits below
- `GET /api/health` — process health, version and selected configured limits

`GET /api/health` and `POST /api/auth/login` are public; the remaining routes
require a verified Supabase access token, the signed session cookie or
`x-api-key`. `POST /api/auth/logout` also works without a session so it can
always clear a stale cookie. Production refuses to start without access control
unless `ALLOW_PUBLIC_API=true`.
`PUBLIC_ORIGIN` restricts credentialed CORS; cookie-authenticated writes with a
mismatched `Origin` are rejected. `TRUST_PROXY` controls whether forwarded
addresses are trusted instead of falling back to the direct peer. AI identity is
the authenticated principal rather than caller-supplied headers.

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

`packages/contracts/src/export.ts` defines four formats, scale 1/2/3 and an optional
idempotency key. `POST /api/export` accepts the multipart request below through
`@fastify/multipart`, validates the document before copying asset file parts, and
returns output bytes with `x-export-*` metadata headers. This implemented route
is distinct from the unsupported standalone upload route.

**Input.** The client sends the canonical `DesignDoc`, never Design HTML: the
editor already holds the document, and a serialize/reparse cycle would let a
lossy round-trip change the design on the way to the renderer. Alongside the
document the client sends **only the image bytes its visible image layers
reference**, not the full asset library. The document still has the 200-layer
limit; the transport does not remove that ceiling.

The request is `multipart/form-data`:

- `options` — JSON with `format` (`png`, `jpeg`, `pdf`, `html`), `scale` (1, 2, 3),
  optional JPEG `quality` (0.1..1, default 0.92), and optional `idempotencyKey`
  (8..128 characters). PDF/HTML ignore scale.
- `doc` — the `DesignDoc` JSON.
- one binary part per referenced asset, named `asset:<id>` (bare IDs are accepted
  too). Send the `options` and `doc` fields before file parts.

A referenced asset with no part fails `ASSET_UNRESOLVED`; an unreferenced part is
rejected. The document is canonicalized and validated
before file parts are copied into request buffers. Repeated requests with the
same `idempotencyKey` from the same principal and peer address return the stored
result instead of rendering again. The memory-only cache is scoped by
authenticated principal plus IP, expires entries after 10 minutes, allows at most
20 entries and 64 MiB in total, and evicts oldest-first. Results larger than the
byte budget are not cached. A SHA-256 digest binds the key to the canonical
document, export options (excluding the key) and referenced asset bytes. Reuse
with a different payload fails `INVALID_DOC`; identical simultaneous requests
share the in-flight result. Clients must use a fresh key per distinct output.

**Asset re-validation.** Supplied bytes are never trusted. For each asset the
server checks bytes, sniffs the real type with `file-type` (`image/png`,
`image/jpeg` or `image/webp`; declared MIME is ignored), then reads `sharp`
metadata without raster decoding. All headers must agree with the sniffed format,
be single-frame and satisfy 8000px sides, 40 MP per image and 80 MP total before
any document image is decoded. At most 20 referenced image assets are accepted.
Unreferenced uploaded parts are rejected. Images are then decoded/re-encoded to
PNG with an input-pixel guard; only those sanitized bytes reach the renderer.
Valid image/polyglot trailers are stripped rather than forwarded as original bytes.
Malformed/unsupported bytes fail `INVALID_DOC`; byte/dimension/pixel-limit failures
can be `LIMIT_EXCEEDED`. Errors identify `assets.<id>`.

**Serialization.** `serializeForExport(doc, assets)` produces one
self-contained HTML document: hidden layers are omitted, every `asset:<id>`
becomes an inline `data:` URI of the re-encoded bytes, and the allowed fonts
are embedded as `@font-face` rules with available Arabic/Latin 400/700 woff2
subsets (some families have only 400). The result
has no external reference of any kind and is the only thing the renderer
receives — never the editor DOM, never the asset URLs.

**Rendering.** The canonical document is serialized in the API process and sent
to a long-lived renderer process over Node IPC; HTML exports are serialization
only and never start a browser. The worker is spawned with a scrubbed environment
containing only `HOME`, `TMPDIR`, `TMP`, `TEMP` and `PLAYWRIGHT_BROWSERS_PATH`:
provider/API keys, Supabase secrets and cookie keys are absent. Its Node heap is
capped with `--max-old-space-size=512`; container-level CPU/memory limits belong
to deployment and are not enforced by the process itself.

In the container topology, `EXPORT_WORKER_URL` switches the API to the worker
service's `POST /render` endpoint (`worker-server.ts`); `EXPORT_WORKER_TOKEN` adds
bearer authentication and `GET /health` stays unauthenticated. Compose runs that
worker as `pwuser`, on an `internal: true` network with no egress, with
CPU/memory/PID limits, and passes only `NODE_ENV`, `WORKER_HOST`, `WORKER_PORT`,
`PLAYWRIGHT_BROWSERS_PATH`, `EXPORT_CHROMIUM_SANDBOX` and the worker token. No
provider, Supabase or access-control secret reaches the renderer. The reference
topology, TLS proxy and sandbox caveat are in `docker-compose.yml` and
[security.md](security.md).

Playwright uses a shared Chromium instance with a fresh context per request:
document JavaScript is disabled, service workers are blocked, the context is
offline, and a route handler aborts every `http(s)` request. Only `data:` URLs
are continued, because images and fonts are embedded. The exported document also
carries CSP `default-src 'none'` with inline styles and data fonts/images.
Chromium's sandbox is explicitly enabled (`chromiumSandbox: true`). In Docker it
needs unprivileged user namespaces or an equivalent capability/seccomp setup;
`EXPORT_CHROMIUM_SANDBOX=false` is only for a disposable worker container with no
network egress when the platform cannot run the sandbox. Do not use that opt-out
for a long-lived worker with network access.

Each job has a 15-second total deadline. A timeout or worker crash kills the
worker's process group (including Chromium children) and the next job starts a
fresh process; jobs are serialized so one hung render cannot overlap another.
Pinned versions are Playwright 1.65.0 and its Chromium 158.0.8127.18 (revision
1254). Deployment must pin the same image/digest. What "JavaScript-free" means
here: no page-authored script executes, no service worker runs, no external
request or navigation is allowed, and the only driver evaluation is the fixed
string `document.fonts.ready`; it does not mean the Chromium process has no
JavaScript engine or that all trusted Playwright evaluation is impossible.

Container egress denial and cgroup limits are supplied by the deployment described
in `docs/security.md`; they are not claimed to be active when running `pnpm dev`.

**Output.**

- `png` / `jpeg`: artboard size x `scale` in pixels. JPEG has no alpha channel
  and Chromium flattens transparency; `quality` defaults to 0.92.
- `pdf`: Chromium's native vector PDF, one page, no margins, with **1 CSS px =
  0.75 pt** (subject to Chromium page-size rounding), not one point per artboard
  pixel. It is not a raster screenshot placed in a PDF. Device scale factor 2
  does not change that physical page-size conversion. A 794x1123 document was
  measured at 595.92x842.88 pt with extractable text and embedded Inter and Cairo
  fonts in separate Latin/Arabic test fixtures. Chromium's Arabic PDF uses shaped
  glyph mappings plus logical `ActualText`; this test is not a print-quality
  guarantee for every Arabic design.
  The UI A4 preset is 794x1123 CSS pixels. Older 2480x3508 documents keep their
  explicit size; choose the A4 preset to change their physical page dimensions.
- `html`: the `serializeForExport` document itself, served as
  `text/html; charset=utf-8` for download. It is a self-contained copy, not
  Design HTML: exported metadata/styles are rejected by `parseDesignHtml`.
  The editor imports it through `importDesignDocument` (§1.1), rebuilding layers
  from the artboard/CSS and turning inline images back into assets. Hidden layers
  and some editor metadata are omitted from export, so it is not a lossless
  project-backup format. Use canonical Design HTML/model persistence for editing
  state rather than assuming the download retains everything.

**Limits and errors** (§8): raster output is limited to 40 MP, response bytes to
40 MiB, with queue 20 and concurrency 2. Oversize output uses `LIMIT_EXCEEDED`
(HTTP 413); queue-full uses `RATE_LIMITED` (HTTP 429); rendering failure/timeout uses `EXPORT_FAILED`;
missing assets use `ASSET_UNRESOLVED`. `EXPORT_DISABLED=true` disables new export
requests at API startup with `UNSUPPORTED_FEATURE`; the limits endpoint remains
available and reports the effective API queue settings. `EXPORT_CONCURRENCY`
(1–2) and `EXPORT_QUEUE_MAX` (0–20) can tighten the API queue's compiled ceilings;
invalid values prevent startup. The worker queue remains separate. The export
service applies a 25-second response deadline covering
queue wait, asset preparation and rendering after multipart reception. Timed-out
queue waiters are removed. Native image decoding and an already-started render
may continue after the response; their queue slot stays occupied until they stop,
and late results are not cached. The deadline cannot preempt synchronous work or
include time spent receiving the multipart request. Visual equality with the
editor remains unverified.

### 12.2 AI contract

`AI_PROVIDER` selects an OpenAI-compatible chat-completions endpoint (`AI_MODEL`,
`AI_BASE_URL`, `AI_API_KEY`). Accepted selectors are `openai` and
`openai-compatible`; missing/unsupported configuration disables the service and
routes answer `UNSUPPORTED_FEATURE`. The files in `prompts/` supply the system
prompts. Generation returns canonical Design HTML; editing returns merged Design
HTML. Snapshot history is kept by the browser rather than the API.

**Provider boundary.** The service calls `AiProvider.complete`. The current
transport sends `AI_API_KEY` in an outbound authorization header, not in a prompt
or web response. It reports the configured model name and provider token usage;
it does not independently resolve provider aliases. Missing token usage becomes
zero, which can undercount cost. No Anthropic adapter or automatic price lookup
exists. API and worker logs apply the bounded redaction policy described in
`docs/security.md`, and the renderer environment is isolated; neither replaces
deployment verification. Do not put shared/provider keys in the public bundle.

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
- The extracted Design HTML is parsed through the security boundary of §9 and
  then canonicalized. A security violation in that parsed fragment produces
  `AI_INVALID_OUTPUT`, not a partially applied edit. Fence/prose trimming before
  parsing is not a browser execution or a repair loop.

**One retry.** Rejected parsed output is retried once with the validation error
appended to the prompt (`LIMITS.ai.retries`), then fails with `AI_INVALID_OUTPUT`.
`UNSUPPORTED_COLOR` warnings also reject the attempt; other warnings do not retry.
Some transport failures, including no-text replies,
throw before that validation retry path. There is no repair loop or hidden model.
Provider calls have a configured timeout/token maximum; extracted output has a
128 KiB check, generation a 60-layer check, and incoming Design HTML its core
limits. These checks are not a single end-to-end deadline or a streaming response
memory limit. Edit output uses the document layer ceiling rather than generation's
60-layer ceiling.

**Browser snapshots.** Before applying a valid edit, the web app stores the
canonical pre-edit document in IndexedDB (`snapshots`, at most 20 entries,
newest first). The AI panel lists recent entries and restores one, deleting that
entry after a successful restore. Snapshots never leave the browser and the
server keeps none. They are lost when site data is cleared and are a convenience,
not durable version history or a collaborative conflict mechanism.

**Daily spend cap.** The total and per-principal totals are persisted per UTC day in a JSON file
(`AI_SPEND_LEDGER_PATH`, default `.data/ai-spend.json`). Writes replace the file by
atomic rename; corrupt content makes startup fail closed rather than silently
resetting the budget. Principals are represented by SHA-256 hashes, which are
pseudonymous rather than anonymous. Reservations stay in memory, including across
UTC midnight while attempts are in flight, and are lost on process restart. A
legacy ledger's unattributed spend counts against each principal until rollover.

Before **each provider attempt** the ledger reserves:

```text
estimatedPromptTokens × inputPrice / 1,000,000
+ maxOutputTokens × outputPrice / 1,000,000
```

If `spent + reserved + estimate` exceeds the configured cap, it returns
`SPEND_CAP_EXCEEDED` (HTTP 402) before that attempt is sent. The reservation is
settled to reported usage immediately after the reply, so a validation retry
reserves its own budget. `AI_USER_DAILY_SPEND_CAP_USD` optionally limits each
authenticated principal and defaults to the deployment cap; all clients sharing
the API key share one principal. At most 10,000 principals are admitted per day;
new principals fail closed when that bound is reached. The prompt estimate remains character-count/4; provider
usage omitted from a reply is treated as zero. Both prices are required at startup
when `AI_PROVIDER` is configured instead of silently defaulting. `AI_DISABLED=true`
turns AI off. Every settlement (reserved, actual, cumulative and model) is logged.

The file is the one piece of durable server state in this build. It is safe for a
single API replica; multiple replicas sharing a path can race, and a replica with
its own file enforces its own cap. Do not treat one process's file as a global
billing ledger.

Generation checks per-principal and per-IP limits; editing checks its per-IP
limiter. Excess returns `RATE_LIMITED` (HTTP 429). Authenticated principals come
from verified Supabase tokens or the API key; the limiter key count still has no
hard global bound.

**Paths.** Generation requires the model output to match the requested artboard
size. Editing merges a model patch with `mergeScopedEdit` (§11.1), preserving the
base artboard and selected layers omitted by the patch. The response contains
the merged design, not an unvalidated patch for the browser to apply.

## 13. Versioning

`schemaVersion` is `1`. A breaking change to the document shape, canonical form,
or security boundary requires a new version and a migration function. Additive
warnings and optional metadata do not. Design HTML carries no version field;
the version lives on `DesignDoc`, and `canonicalizeDoc` rejects a document whose
`schemaVersion` is not `1` with `UNSUPPORTED_FEATURE`.

## 14. Reference implementation

- `packages/core/src/parse.ts` — parse5 whitelist parser
- `packages/core/src/import.ts` — broader HTML/CSS-to-layer conversion
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
  `golden`, `merge-scoped`, `svg-casing`, `import`, `style-edge-cases`, `untrusted`
  and `perf` suites
- `apps/server/src/` — API routes, auth, AI accounting and export implementation
- `apps/server/test/` — AI, auth, spend, API, export contract/cache and rendering tests

## 15. Contract changelog

### 2026-11-10 — Phase 8 UI language

- Editor chrome uses typed Arabic/English dictionaries. The `AR / EN` toggle
  persists to `localStorage` under `poster.ui.lang` and updates the app and
  document `dir`/`lang`; design content is not translated.

### 2026-11-10 — Phase 3 correctness and editor persistence

- Artboard data dimensions accept positive numbers or px; output stays canonical px.
- Shared typography limits, mandatory zero Arabic/RTL spacing and up to two internal
  text breaks preserve canonical round trips and a single blank line.
- Unsupported text/fill/border/shadow/SVG paint emits `UNSUPPORTED_COLOR`, which
  triggers the existing one-retry AI policy without changing manual-import fallbacks.
- The A4 UI preset uses 794x1123 CSS pixels and has vector/text/page-size tests.
- Current documents and one backup use browser IndexedDB with migration, explicit
  recovery and transaction-level stale-tab checks; no server document store was added.
- Snapshot cap and eviction are browser-local and atomic across tabs.

### 2026-11-09 — Phase 2 access, spend and state changes

- Added the Supabase-backed auth routes and documented which routes are public,
  how the session cookie/API key are accepted and the production fail-fast rule.
- Removed server snapshot storage and `GET /api/ai/snapshots/:id`; snapshot
  history now lives in browser IndexedDB with a restore list in the AI panel.
- Scoped export idempotency to principal + IP and documented the 10-minute TTL,
  20-entry and 64 MiB cache bounds and the missing request-content match.
- Recorded the durable single-replica spend ledger, per-attempt reservations,
  required prices, `AI_DISABLED` and settlement logging.

### 2026-11-09 — Phase 2 web boundary, renderer worker and documentation updates

- Documented the strict editor app CSP (`default-src 'none'`, `script-src 'self'`,
  no inline scripts, no `'unsafe-eval'`, same-origin `connect-src`,
  `frame-ancestors 'none'` from the reverse proxy) delivered by the Vite
  build-only plugin.
- Documented the internal HTTP export worker protocol (`GET /health`, `POST
/render` with the Zod-validated job, optional bearer token) and the
  `EXPORT_WORKER_URL` selection.

### 2026-11-09 — Documentation corrections, no schema/runtime change

- Distinguished canonical producer requirements, restricted parsing and broader
  HTML/CSS import; documented current compatibility conversions and range gaps.
- Corrected the named-color table/defaults, inline dropping behavior and Arabic
  spacing behavior instead of promising unsupported warnings.
- Marked scoped editing, missing-asset errors and export formats as implemented;
  identified the standalone upload route as a stub.
- Corrected full-document edit prompts, snapshot durability/ownership, retry spend
  reservations, rate/body limits, cache scope and renderer containment claims.
- Specified native PDF's CSS-pixel-to-point conversion and the actual A4 preset
  defect, without replacing working vector rendering.

See [the project changelog](../CHANGELOG.md) for source checkpoints and
[the audit](audit.md) for evidence and verification. Correcting documentation
does not close the corresponding implementation/security findings.
