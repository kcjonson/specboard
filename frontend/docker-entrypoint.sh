#!/bin/sh
set -e

# Build SSG pages if they don't exist (requires web build first for manifest)
if [ ! -f ssg/dist/login.html ]; then
    echo "Building SSG pages (first run)..."
    pnpm --filter @doc-platform/web build
    pnpm --filter @doc-platform/ssg build
    echo "SSG build complete."
fi

# Start all dev servers in parallel
echo "Starting dev servers..."
pnpm --filter @doc-platform/web dev --host 0.0.0.0 &
pnpm --filter @doc-platform/ssg dev &
node --experimental-transform-types --watch frontend/src/index.ts
