# syntax=docker/dockerfile:1.7
# Static editor shell. The CSP is injected at build time by the Vite plugin;
# the reverse proxy supplies frame-ancestors and transport security headers.

FROM node:22.23.4-bookworm-slim AS build

RUN npm install --global pnpm@12.16.1
WORKDIR /src
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @poster/web build

FROM nginx:1.28-alpine AS runtime

COPY docker/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1
