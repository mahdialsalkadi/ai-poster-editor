# syntax=docker/dockerfile:1.7
# API service: Fastify, AI provider client, spend ledger and export orchestration.
# The renderer is never started in this image; it is reached over the internal
# network with EXPORT_WORKER_URL.

FROM node:22.23.4-bookworm-slim AS build

RUN npm install --global pnpm@12.16.1
WORKDIR /src
COPY . .

RUN pnpm install --frozen-lockfile
# Build the server and its workspace dependencies, then copy only production
# files and production dependencies into a self-contained directory.
RUN pnpm --filter "@poster/server..." build
RUN pnpm --filter @poster/server deploy --prod /out

FROM node:22.23.4-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001

WORKDIR /app
COPY --from=build --chown=node:node /out/ ./

# The durable spend ledger is the only server-side state. It lives on a volume
# and must be owned by the unprivileged runtime user.
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3001') + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
