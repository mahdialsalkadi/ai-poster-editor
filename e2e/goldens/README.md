# Reviewed export goldens

Three 600 × 800 PNGs at **1×** cover English/Inter, Arabic/Cairo and SVG local
gradients. They pass through the real multipart API and isolated renderer, not a
mock PNG response. Fonts are embedded from the frozen workspace dependencies.

Pinned environment: Playwright **1.65.0**, Chromium **158.0.8127.18**, revision
**1254**, headless Linux with the Chromium sandbox enabled. The test verifies
both the runner and server Playwright versions and the launched browser version.
Locale is en-US, timezone UTC and fixture content has no timestamps or randomness.

Comparison uses a per-pixel color threshold of **0.2** and at most **0.3%**
different pixels, allowing small rasterization differences without masking layout
or missing-content changes. The comparator decodes raw pixels through the
workspace's existing `sharp` dependency rather than Playwright's snapshot PNG
decoder, which crashes on the current Node 27 alpha's class-based `Inflate`.
Normal test runs (including CI) **never update** goldens, even if a file is missing.

```bash
pnpm build
pnpm test:visual

# Intentional updates only; inspect every PNG diff before committing.
pnpm update-goldens
pnpm test:visual
```

Regenerate on Linux using the pinned browser/fonts. A browser, font, model or
renderer update requires reviewing the actual images, not merely accepting new
snapshots to make CI green. Playwright failure traces are ignored generated output.

These are exporter regressions on three reference designs, not proof of universal
pixel equality between all editor designs and every export format. The separate
editor E2E suite checks interactive rendering and downloaded PNG/PDF dimensions.
