# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

WORKDIR /app

# Copy workspace config first (for better layer caching)
# Use Docker-specific workspace that only includes packages we need
COPY frontend/pnpm-workspace.docker.yaml ./pnpm-workspace.yaml
COPY package.json pnpm-lock.yaml ./

# Copy only package.json files to install dependencies
# Frontend server dependencies
COPY shared/core/package.json ./shared/core/
COPY shared/auth/package.json ./shared/auth/
COPY frontend/package.json ./frontend/
# Planning-web SPA dependencies
COPY shared/ui/package.json ./shared/ui/
COPY shared/models/package.json ./shared/models/
COPY shared/router/package.json ./shared/router/
COPY shared/fetch/package.json ./shared/fetch/
COPY web/package.json ./web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY shared/core ./shared/core
COPY shared/auth ./shared/auth
COPY shared/ui ./shared/ui
COPY shared/models ./shared/models
COPY shared/router ./shared/router
COPY shared/fetch ./shared/fetch
COPY shared/projects ./shared/projects
COPY frontend ./frontend
COPY web ./web
COPY shared/planning ./shared/planning
COPY shared/pages ./shared/pages

# Build shared packages first, then frontend server, then SPA
# Order matters: core first, then packages that depend on it
RUN pnpm --filter @doc-platform/core build && \
    pnpm --filter @doc-platform/auth build && \
    pnpm --filter @doc-platform/fetch build && \
    pnpm --filter @doc-platform/router build && \
    pnpm --filter @doc-platform/models build && \
    pnpm --filter @doc-platform/frontend build && \
    pnpm --filter @doc-platform/web build

# Production stage
FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

WORKDIR /app

# Copy workspace config
COPY frontend/pnpm-workspace.docker.yaml ./pnpm-workspace.yaml
COPY package.json pnpm-lock.yaml ./
COPY shared/core/package.json ./shared/core/
COPY shared/auth/package.json ./shared/auth/
COPY frontend/package.json ./frontend/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built output
COPY --from=builder /app/shared/core/dist ./shared/core/dist
COPY --from=builder /app/shared/auth/dist ./shared/auth/dist
COPY --from=builder /app/frontend/dist ./frontend/dist

# Copy built SPA to static directory
COPY --from=builder /app/web/dist ./frontend/static

WORKDIR /app/frontend

EXPOSE 3000

CMD ["node", "dist/index.js"]
