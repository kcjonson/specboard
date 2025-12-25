# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

WORKDIR /app

# Copy workspace config first (for better layer caching)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy only package.json files to install dependencies
COPY shared/core/package.json ./shared/core/
COPY shared/auth/package.json ./shared/auth/
COPY frontend/package.json ./frontend/
COPY planning-web/package.json ./planning-web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY shared/core ./shared/core
COPY shared/auth ./shared/auth
COPY frontend ./frontend
COPY planning-web ./planning-web

# Build shared packages first, then frontend server, then SPA
RUN pnpm --filter @doc-platform/core build && \
    pnpm --filter @doc-platform/auth build && \
    pnpm --filter @doc-platform/frontend build && \
    pnpm --filter planning-web build

# Production stage
FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
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
COPY --from=builder /app/planning-web/dist ./frontend/static

WORKDIR /app/frontend

EXPOSE 3000

CMD ["node", "dist/index.js"]
