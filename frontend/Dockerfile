# Build stage
FROM node:20-alpine AS builder

# Build arg for git SHA (passed at build time)
ARG GIT_SHA=unknown

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
COPY shared/db/package.json ./shared/db/
COPY shared/auth/package.json ./shared/auth/
COPY frontend/package.json ./frontend/
# SPA and SSG dependencies
COPY shared/ui/package.json ./shared/ui/
COPY shared/models/package.json ./shared/models/
COPY shared/router/package.json ./shared/router/
COPY shared/fetch/package.json ./shared/fetch/
COPY shared/telemetry/package.json ./shared/telemetry/
COPY web/package.json ./web/
COPY ssg/package.json ./ssg/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY shared/core ./shared/core
COPY shared/db ./shared/db
COPY shared/auth ./shared/auth
COPY shared/ui ./shared/ui
COPY shared/models ./shared/models
COPY shared/router ./shared/router
COPY shared/fetch ./shared/fetch
COPY shared/telemetry ./shared/telemetry
COPY shared/projects ./shared/projects
COPY frontend ./frontend
COPY web ./web
COPY ssg ./ssg
COPY shared/planning ./shared/planning
COPY shared/pages ./shared/pages

# Build shared packages first, then frontend server, then SPA, then SSG
# Order matters: core first, then packages that depend on it
# SSG must run after web build to read CSS manifest
RUN pnpm --filter @doc-platform/core build && \
    pnpm --filter @doc-platform/db build && \
    pnpm --filter @doc-platform/auth build && \
    pnpm --filter @doc-platform/fetch build && \
    pnpm --filter @doc-platform/router build && \
    pnpm --filter @doc-platform/models build && \
    pnpm --filter @doc-platform/telemetry build && \
    pnpm --filter @doc-platform/frontend build && \
    pnpm --filter @doc-platform/web build && \
    pnpm --filter @doc-platform/ssg build

# Create version.txt with git SHA
RUN echo "${GIT_SHA}" > /app/web/dist/version.txt

# Production stage
FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

WORKDIR /app

# Download AWS RDS CA bundle for SSL certificate verification
RUN wget -O /app/rds-ca-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

# Copy workspace config
COPY frontend/pnpm-workspace.docker.yaml ./pnpm-workspace.yaml
COPY package.json pnpm-lock.yaml ./
COPY shared/core/package.json ./shared/core/
COPY shared/db/package.json ./shared/db/
COPY shared/auth/package.json ./shared/auth/
COPY frontend/package.json ./frontend/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built output
COPY --from=builder /app/shared/core/dist ./shared/core/dist
COPY --from=builder /app/shared/db/dist ./shared/db/dist
COPY --from=builder /app/shared/auth/dist ./shared/auth/dist
COPY --from=builder /app/frontend/dist ./frontend/dist

# Copy built SPA to static directory
COPY --from=builder /app/web/dist ./frontend/static
# Copy SSG pages to static/ssg directory
COPY --from=builder /app/ssg/dist ./frontend/static/ssg

WORKDIR /app/frontend

EXPOSE 3000

CMD ["node", "dist/index.js"]
