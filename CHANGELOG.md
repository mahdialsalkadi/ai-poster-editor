# Changelog

This file records changes to AI Poster Editor. Version tags identify source
checkpoints; they do not imply approval for public deployment.

## [Unreleased]

### Changed

- Corrected the contract's obsolete route/milestone notes and unsupported safety
  claims, documented the separate import boundary and actual PDF conversion, and
  added a contract changelog. The example environment now describes real state
  and settings instead of advertising unused limit overrides.
- Replaced the duplicated README with one loopback-only quick start, accurate
  test/milestone statements, the declared Node requirement and explicit public
  deployment limitations.
- Added a GitHub Actions workflow for Node 22 and the latest Node, pnpm 12.16.1,
  frozen installs, typecheck, lint, formatting, tests and build. Production audit
  is initially advisory; the README badge now reports the actual workflow.
- Applied the existing Prettier policy across application source, tests and docs.
  Byte-exact HTML fixtures, captured evidence, generated output and local tooling
  are excluded from automatic formatting.
- Scoped linting away from local tooling/captures and fixed three baseline lint
  errors without changing application behavior.

### Security

- Added Supabase Auth email/password sign-in with HMAC-signed HttpOnly session
  cookies, HS256/JWKS token verification, constant-time API-key fallback,
  production startup refusal without access control, `PUBLIC_ORIGIN` CORS/origin
  checks, `TRUST_PROXY` and principal-plus-IP rate limits.
- Persisted the daily AI spend ledger with atomic file replacement, per-attempt
  reservations for retries, mandatory prices, `AI_DISABLED` and settlement
  logging; corrupt ledgers fail closed.
- Removed server-side edit snapshots and their API route. The web now keeps up to
  20 pre-edit snapshots in IndexedDB with a restore list in the AI panel.
- Scoped export idempotency cache entries by principal and IP and bounded them
  with a 10-minute TTL, 20-entry/64 MiB caps and oldest-first eviction.
- Upgraded Zod to patched 4.6.6; `pnpm audit --prod` reports no known
  vulnerabilities.

## [0.1.0] - 2026-11-09

Local baseline checkpoint before the remaining Phase 1 hardening work. MIT
licensing and the public-deployment decision were recorded before this tag;
there was no earlier version tag to preserve.

### Added

- Canonical Design HTML model, parser, serializer, validation and scoped merge.
- Arabic-first React editor with layer manipulation, inline text editing,
  snapping, undo/redo, template gallery and local document/asset persistence.
- OpenAI-compatible generation and scoped edits with in-memory snapshots and
  daily spend accounting.
- PNG, JPEG, native PDF and self-contained HTML export with asset revalidation.
- Core, server and web tests: 235 tests passed in the Phase 0 audit.
- MIT project license and notices for all 11 OFL-licensed font families.
- Evidence-based [audit](docs/audit.md) and a public deployment target requiring
  sign-in-protected AI and export operations.

### Known limitations

This checkpoint is **not safe for public exposure**. Authentication, durable
retry-safe spending limits, snapshot/cache ownership, renderer containment and
web CSP still require Phase 2 hardening. The A4 preset's physical PDF size,
document persistence and remaining editor gaps are also open. See the audit for
the complete findings and verification results.
