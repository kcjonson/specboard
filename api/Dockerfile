# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

WORKDIR /app

# Copy workspace config first (for better layer caching)
# Use Docker-specific workspace that only includes packages we need
COPY api/pnpm-workspace.docker.yaml ./pnpm-workspace.yaml
COPY package.json pnpm-lock.yaml ./

# Copy only package.json files to install dependencies
COPY shared/core/package.json ./shared/core/
COPY shared/db/package.json ./shared/db/
COPY shared/auth/package.json ./shared/auth/
COPY shared/email/package.json ./shared/email/
COPY api/package.json ./api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY shared/core ./shared/core
COPY shared/db ./shared/db
COPY shared/auth ./shared/auth
COPY shared/email ./shared/email
COPY api ./api

# Build shared packages first, then API
# Note: auth depends on db, so build db before auth
# Note: email has no internal deps, can build anytime before api
RUN pnpm --filter @doc-platform/core build && \
    pnpm --filter @doc-platform/db build && \
    pnpm --filter @doc-platform/auth build && \
    pnpm --filter @doc-platform/email build && \
    pnpm --filter @doc-platform/api build

# Production stage
FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

WORKDIR /app

# Download AWS RDS CA bundle for SSL certificate verification
RUN wget -O /app/rds-ca-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

# Copy workspace config
COPY api/pnpm-workspace.docker.yaml ./pnpm-workspace.yaml
COPY package.json pnpm-lock.yaml ./
COPY shared/core/package.json ./shared/core/
COPY shared/db/package.json ./shared/db/
COPY shared/auth/package.json ./shared/auth/
COPY shared/email/package.json ./shared/email/
COPY api/package.json ./api/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built output
COPY --from=builder /app/shared/core/dist ./shared/core/dist
COPY --from=builder /app/shared/db/dist ./shared/db/dist
COPY --from=builder /app/shared/auth/dist ./shared/auth/dist
COPY --from=builder /app/shared/email/dist ./shared/email/dist
COPY --from=builder /app/api/dist ./api/dist

# Copy migrations and seed script
COPY --from=builder /app/shared/db/migrations ./shared/db/migrations
COPY --from=builder /app/shared/db/seed.mjs ./shared/db/seed.mjs

EXPOSE 3001

CMD ["node", "api/dist/index.js"]
