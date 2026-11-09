# syntax=docker/dockerfile:1.7
# Renderer worker: the only service allowed to start Chromium. It serves the
# internal POST /render and GET /health endpoints and is never published.
# The base image fixes Playwright and its Chromium; keep both versions in step
# with the exact "playwright" pin in apps/server/package.json.

FROM node:22.23.4-bookworm-slim AS build

RUN npm install --global pnpm@12.16.1
WORKDIR /src
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@poster/server..." build
RUN pnpm --filter @poster/server deploy --prod /out

FROM mcr.microsoft.com/playwright:v1.65.0-noble AS runtime

ENV NODE_ENV=production \
    WORKER_HOST=0.0.0.0 \
    WORKER_PORT=3002 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /out/ ./

# Non-root user shipped by the Playwright image. Chromium's sandbox is enabled
# by default; see docs/security.md before disabling it.
USER pwuser
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.WORKER_PORT || '3002') + '/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/worker.js"]
