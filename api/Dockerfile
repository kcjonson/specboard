# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

WORKDIR /app

# Copy workspace config first (for better layer caching)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy only package.json files to install dependencies
COPY shared/core/package.json ./shared/core/
COPY api/package.json ./api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY shared/core ./shared/core
COPY api ./api

# Build shared packages first, then API
RUN pnpm --filter @doc-platform/core build && \
    pnpm --filter @doc-platform/api build

# Production stage
FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/core/package.json ./shared/core/
COPY api/package.json ./api/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built output
COPY --from=builder /app/shared/core/dist ./shared/core/dist
COPY --from=builder /app/api/dist ./api/dist

EXPOSE 3001

CMD ["node", "api/dist/index.js"]
