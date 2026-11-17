# Clock & Compass — single-container image: build the frontend, then serve it as static
# files from the Fastify backend. SQLite DB lives on a mounted volume.
#
# Three stages:
#   build    — install everything and compile core/server and both web apps (needs devDeps).
#   proddeps — a clean PRODUCTION-only install (no devDeps) + Prisma client.
#   runtime  — proddeps tree + the compiled artifacts. No build tooling shipped.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ---- Build stage: compile everything -----------------------------------------
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# prisma generate + core (tsup) + server (tsup, bundles core) + web and web-react (vite).
RUN pnpm build

# ---- Prod-deps stage: production node_modules only ---------------------------
FROM base AS proddeps
COPY . .
RUN pnpm install --prod --frozen-lockfile
# Generate the Prisma client into the production node_modules.
RUN pnpm --filter @clock-compass/core exec prisma generate

# ---- Runtime stage -----------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATABASE_URL=file:/data/dev.db

# Production dependencies + Prisma client + schema/migrations + sources.
COPY --from=proddeps /app /app
# Overlay the compiled output (the proddeps stage never built these).
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
# The React port (issue #64), built alongside. Not served unless
# WEB_DIST_PATH=/app/apps/web-react/dist; the Svelte app stays the default.
COPY --from=build /app/apps/web-react/dist ./apps/web-react/dist

# SQLite database directory (mount a volume here to persist across restarts).
RUN mkdir -p /data
VOLUME ["/data"]

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
