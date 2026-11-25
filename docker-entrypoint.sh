#!/bin/sh
# Apply any pending migrations against the (persisted) SQLite database, then
# start the server. Safe to run on every boot — migrate deploy is idempotent.
#
# prisma is a dependency of @clock-compass/core, so its CLI binary lives in that
# package's node_modules/.bin (pnpm does not hoist it to the root).
set -e

# Every stored day must be a plain date (#137). Checked before the migrations,
# so a refused start changes nothing, not even the schema, and the version to
# pass through first meets a schema it knows.
node apps/server/dist/check-stored-days.js

echo "Applying database migrations..."
packages/core/node_modules/.bin/prisma migrate deploy \
  --schema packages/core/prisma/schema.prisma

echo "Starting Clock & Compass server..."
exec node apps/server/dist/index.js
