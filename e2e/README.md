# Browser quality gates

Run from the repository root using Node >=22.23.4 and the pinned pnpm version:

```bash
pnpm install --frozen-lockfile
pnpm --filter @poster/server exec playwright install --with-deps chromium
pnpm build
pnpm test:e2e
```

`pnpm typecheck` also checks these TypeScript tests, fixtures and configuration.
The runner owns a server on **127.0.0.1:4190** and refuses to reuse an existing
listener. It starts/stops the server automatically. Build first; tests deliberately
exercise the production bundle and its CSP, not a development HMR build.

## Coverage

- `editor.spec.ts`: template selection, mouse transforms, Arabic/English native
  clipboard paste, blank lines, undo/redo, reload, mock generation/edit, snapshot
  restore, actual PNG/PDF downloads, invalid output and the 20-snapshot cap.
- `canvas.spec.ts`: Shift/marquee selection, layer clipboard/offsets, pan and
  actual browser enforcement of the production CSP.
- `storage.spec.ts`: migration, corrupt-record recovery, two-tab conflicts,
  quota failure and unavailable storage. Every test gets isolated site data.
- `visual.spec.ts`: three 1× export goldens; see [goldens/README.md](goldens/README.md)
  for the pinned browser/font policy, tolerance and explicit update command.

Tests use actual mouse/keyboard input and browser clipboard permissions. Database
fault tests intentionally inject errors or corrupt records **inside the isolated
test context**; they do not touch the operator's browser or repository `.env`.
There are no test skips, retries, forced clicks or screenshot auto-updates.

## Isolation

`server.ts` is a test fixture, not a deployment option. It requires
`POSTER_E2E=true`, binds only to loopback, explicitly supplies an in-memory mock
AI provider with zero prices, and never loads private environment files or calls
an external AI API. Authentication is intentionally disabled **only in this
fixture**; Fastify auth/signature/origin/rate tests exercise the real auth layer.

Chromium's sandbox stays enabled for the runner and renderer. Hosts must permit
the required user namespaces; CI configures Ubuntu 24.04 accordingly. Do not
disable the sandbox merely to make tests pass.

Reports live in `playwright-report/` and `test-results/`; traces/screenshots are
retained on failure. CI uploads these and `coverage/` for 14 days in each Node
matrix job. Normal CI runs never regenerate goldens.
