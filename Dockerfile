# Clock & Compass — single-container image: build the frontend, then serve it as static
# files from the Fastify backend. SQLite DB lives on a mounted volume.
#
# Three stages:
#   build    — install everything and compile core/server and the web app (needs devDeps).
#   proddeps — a clean PRODUCTION-only install (no devDeps) + Prisma client.
#   runtime  — proddeps tree + the compiled artifacts. No build tooling shipped.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ---- Build stage: compile everything -----------------------------------------
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# The version of this build (#140), passed by the release workflow. Here the
# web build bakes it into the app; empty values build an app that says
# "unknown: built without version information". Declared after the install
# so a new commit does not undo its cache.
ARG GIT_COMMIT=""
ARG BUILD_DATE=""
ARG GIT_TAG=""
# prisma generate + core (tsup) + server (tsup, bundles core) + web (vite).
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
# The MCP program and its App page (#118), started by an MCP host with
# `docker exec -i <container> node packages/mcp/dist/index.js --app`.
COPY --from=build /app/packages/mcp/dist ./packages/mcp/dist
COPY --from=build /app/apps/web/dist-mcp-app ./apps/web/dist-mcp-app

# SQLite database directory (mount a volume here to persist across restarts).
RUN mkdir -p /data
VOLUME ["/data"]

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# The same version for the server (#140): baked into the image, read by
# /api/health and the first log line. Not a setting; last, to keep the
# layers above cached.
ARG GIT_COMMIT=""
ARG BUILD_DATE=""
ARG GIT_TAG=""
ENV GIT_COMMIT=$GIT_COMMIT \
    BUILD_DATE=$BUILD_DATE \
    GIT_TAG=$GIT_TAG

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
