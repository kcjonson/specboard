# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

WORKDIR /app

# Copy workspace config first (for better layer caching)
# Use Docker-specific workspace that only includes packages we need
COPY mcp/pnpm-workspace.docker.yaml ./pnpm-workspace.yaml
COPY package.json pnpm-lock.yaml ./

# Copy only package.json files to install dependencies
COPY shared/core/package.json ./shared/core/
COPY shared/db/package.json ./shared/db/
COPY mcp/package.json ./mcp/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY shared/core ./shared/core
COPY shared/db ./shared/db
COPY mcp ./mcp

# Build shared packages first, then MCP
RUN pnpm --filter @doc-platform/core build && \
    pnpm --filter @doc-platform/db build && \
    pnpm --filter @doc-platform/mcp build

# Production stage
FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

# Download AWS RDS CA bundle for SSL certificate verification
RUN wget -O /app/rds-ca-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

WORKDIR /app

# Copy workspace config
COPY mcp/pnpm-workspace.docker.yaml ./pnpm-workspace.yaml
COPY package.json pnpm-lock.yaml ./
COPY shared/core/package.json ./shared/core/
COPY shared/db/package.json ./shared/db/
COPY mcp/package.json ./mcp/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built output
COPY --from=builder /app/shared/core/dist ./shared/core/dist
COPY --from=builder /app/shared/db/dist ./shared/db/dist
COPY --from=builder /app/mcp/dist ./mcp/dist

EXPOSE 3002

ENV PORT=3002

CMD ["node", "mcp/dist/index.js"]
