# COMPLETE - 2026-01-18

# Containerized Dev Environment with Hot Reloading

## Summary

Upgrade to Node 25 and use native TypeScript support for a simple dev environment with hot reloading. No separate package builds needed.

## Key Changes

1. **Upgrade Node 20 → Node 25** (native TypeScript)
2. **Add `tsconfig-paths`** for path alias resolution
3. **Add dev target** to Dockerfiles
4. **Update `docker-compose.yml`** with volume mounts
5. **Update `nginx.conf`** with Vite HMR routes

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      docker compose up                           │
│                                                                  │
│  ┌──────────┐  ┌─────────────────────────────────────────────┐  │
│  │  nginx   │  │              api (Node 25)                   │  │
│  │   :80    │──│  node --watch --experimental-strip-types    │  │
│  │          │  │       --import tsconfig-paths/register      │  │
│  │          │  │              api/src/index.ts                │  │
│  │          │  │                                              │  │
│  │          │  │  Watches: api/src/* + shared/*/src/*        │  │
│  └──────────┘  └─────────────────────────────────────────────┘  │
│       │                                                          │
│       │        ┌─────────────────────────────────────────────┐  │
│       │        │           frontend (Node 25)                 │  │
│       └────────│  Vite dev server :5173 (HMR)                │  │
│                │  + Hono auth server :3000                    │  │
│                │                                              │  │
│                │  Watches: web/src/* + shared/*/src/*        │  │
│                └─────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────┐  ┌──────────┐                                     │
│  │    db    │  │  redis   │                                     │
│  │  :5432   │  │  :6379   │                                     │
│  └──────────┘  └──────────┘                                     │
└─────────────────────────────────────────────────────────────────┘
```

## Files to Modify

### 1. Add `tsconfig-paths` dependency

```bash
pnpm add -Dw tsconfig-paths
```

### 2. `api/Dockerfile` - Add dev target at TOP

```dockerfile
# ===== DEV TARGET =====
FROM node:25-alpine AS dev
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate
RUN apk add --no-cache git
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY api/pnpm-workspace.docker.yaml ./pnpm-workspace.yaml
COPY shared/core/package.json ./shared/core/
COPY shared/db/package.json ./shared/db/
COPY shared/auth/package.json ./shared/auth/
COPY shared/email/package.json ./shared/email/
COPY api/package.json ./api/
COPY tsconfig.json ./

RUN pnpm install

EXPOSE 3001
CMD ["node", "--watch", "--experimental-strip-types", "--import", "tsconfig-paths/register", "api/src/index.ts"]

# ===== PRODUCTION STAGES (unchanged) =====
FROM node:25-alpine AS base
# ... rest of existing Dockerfile, just update node:20 → node:25
```

### 3. `frontend/Dockerfile` - Add dev target at TOP

```dockerfile
# ===== DEV TARGET =====
FROM node:25-alpine AS dev
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY frontend/pnpm-workspace.docker.yaml ./pnpm-workspace.yaml
COPY shared/core/package.json ./shared/core/
COPY shared/db/package.json ./shared/db/
COPY shared/auth/package.json ./shared/auth/
COPY shared/ui/package.json ./shared/ui/
COPY shared/models/package.json ./shared/models/
COPY shared/router/package.json ./shared/router/
COPY shared/fetch/package.json ./shared/fetch/
COPY shared/telemetry/package.json ./shared/telemetry/
COPY shared/pages/package.json ./shared/pages/
COPY frontend/package.json ./frontend/
COPY web/package.json ./web/
COPY ssg/package.json ./ssg/
COPY tsconfig.json ./

RUN pnpm install

EXPOSE 3000 5173
CMD ["sh", "-c", "pnpm --filter @doc-platform/web dev --host 0.0.0.0 & node --watch --experimental-strip-types --import tsconfig-paths/register frontend/src/index.ts"]

# ===== PRODUCTION STAGES (unchanged) =====
FROM node:25-alpine AS base
# ... rest of existing Dockerfile, just update node:20 → node:25
```

### 4. `mcp/Dockerfile` - Update Node version

```dockerfile
# Just update node:20-alpine → node:25-alpine in existing stages
```

### 5. `docker-compose.yml` - Add dev configuration

```yaml
services:
  api:
    build:
      context: .
      dockerfile: api/Dockerfile
      target: dev                    # ADD: use dev target
    volumes:                         # ADD: mount source code
      - ./api/src:/app/api/src:cached
      - ./shared/core/src:/app/shared/core/src:cached
      - ./shared/db/src:/app/shared/db/src:cached
      - ./shared/db/migrations:/app/shared/db/migrations:cached
      - ./shared/auth/src:/app/shared/auth/src:cached
      - ./shared/email/src:/app/shared/email/src:cached
      - ./tsconfig.json:/app/tsconfig.json:cached
      - ${HOST_PROJECT_PATH:-.}:/host/doc-platform
    # ... rest unchanged

  frontend:
    build:
      context: .
      dockerfile: frontend/Dockerfile
      target: dev                    # ADD: use dev target
    ports:
      - "3000:3000"
      - "5173:5173"                  # ADD: Vite HMR port
    volumes:                         # ADD: mount source code
      - ./web/src:/app/web/src:cached
      - ./web/index.html:/app/web/index.html:cached
      - ./web/vite.config.ts:/app/web/vite.config.ts:cached
      - ./frontend/src:/app/frontend/src:cached
      - ./shared/ui/src:/app/shared/ui/src:cached
      - ./shared/models/src:/app/shared/models/src:cached
      - ./shared/router/src:/app/shared/router/src:cached
      - ./shared/fetch/src:/app/shared/fetch/src:cached
      - ./shared/core/src:/app/shared/core/src:cached
      - ./shared/telemetry/src:/app/shared/telemetry/src:cached
      - ./shared/pages:/app/shared/pages:cached
      - ./shared/planning:/app/shared/planning:cached
      - ./shared/projects:/app/shared/projects:cached
      - ./ssg/src:/app/ssg/src:cached
      - ./tsconfig.json:/app/tsconfig.json:cached
    environment:
      VITE_DEV_SERVER: http://localhost:5173  # ADD
    # ... rest unchanged
```

### 6. `nginx.conf` - Add Vite HMR routes

Add before the `location /` block:

```nginx
# Vite HMR WebSocket
location /__vite_hmr {
    proxy_pass http://frontend:5173;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}

# Vite dev assets
location /@vite/ {
    proxy_pass http://frontend:5173;
    proxy_set_header Host $host;
}

location /@fs/ {
    proxy_pass http://frontend:5173;
    proxy_set_header Host $host;
}

location /node_modules/.vite/ {
    proxy_pass http://frontend:5173;
    proxy_set_header Host $host;
}
```

### 7. `web/vite.config.ts` - Add server config

```typescript
export default defineConfig({
    // ... existing config
    server: {
        host: '0.0.0.0',
        port: 5173,
        strictPort: true,
        hmr: {
            clientPort: 80,
            host: 'localhost',
        },
        watch: {
            usePolling: true,
            interval: 100,
        },
    },
    css: {
        devSourcemap: true,
    },
});
```

### 8. `frontend/src/index.ts` - Add Vite proxy

Add near top:
```typescript
const VITE_DEV_SERVER = process.env.VITE_DEV_SERVER;
```

In SPA serving logic (for authenticated users):
```typescript
if (VITE_DEV_SERVER) {
    // Dev: proxy to Vite for HMR
    const response = await fetch(`${VITE_DEV_SERVER}${path}`);
    return new Response(response.body, {
        status: response.status,
        headers: response.headers,
    });
} else {
    // Prod: serve pre-built SPA
    return servePage(c, spaIndex);
}
```

## What Gets Watched

| Source Change | Watcher | Reload Type |
|---------------|---------|-------------|
| `web/src/*` | Vite | HMR (instant) |
| `shared/ui/src/*` | Vite | HMR (instant) |
| `api/src/*` | Node --watch | Restart (~1s) |
| `shared/core/src/*` | Node --watch | Restart (~1s) |
| `shared/db/src/*` | Node --watch | Restart (~1s) |
| `frontend/src/*` | Node --watch | Restart (~1s) |

## Usage

```bash
# Start dev environment (same command as before)
docker compose up

# Rebuild when dependencies change
docker compose build
```

## Verification

1. `docker compose up`
2. Open http://localhost
3. Edit `web/src/App.tsx` → HMR update in browser (instant)
4. Edit `api/src/index.ts` → See restart in terminal (~1s)
5. Edit `shared/core/src/index.ts` → Both services restart
6. Browser DevTools → Sources → TypeScript source maps work

## Files Changed Summary

| File | Change |
|------|--------|
| `package.json` | Add tsconfig-paths devDependency |
| `api/Dockerfile` | Add dev target, update to Node 25 |
| `frontend/Dockerfile` | Add dev target, update to Node 25 |
| `mcp/Dockerfile` | Update to Node 25 |
| `docker-compose.yml` | Add target, volumes, ports |
| `nginx.conf` | Add Vite HMR routes |
| `web/vite.config.ts` | Add server config |
| `frontend/src/index.ts` | Add Vite proxy for dev |

## CI/CD Impact

None. CI/CD uses `docker build` without specifying target, so it uses the last stage (production) by default.
