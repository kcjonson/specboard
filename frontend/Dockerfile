# ===== DEV TARGET =====
# Used by docker-compose for local development with hot reloading
# Source and deps are mounted/installed at runtime
FROM node:25-alpine AS dev

RUN npm install -g pnpm@9.15.1

WORKDIR /app

# Download AWS RDS CA bundle for SSL certificate verification
RUN wget -O /app/rds-ca-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

# Port 3000: Frontend server (serves SPA and SSG pages)
# Port 5173: Vite dev server (HMR WebSocket and source files)
EXPOSE 3000 5173

CMD ["node", "--watch", "frontend/src/index.ts"]

# ===== PRODUCTION BUILD STAGE =====
FROM node:25-alpine AS builder

# Build arg for git SHA (passed at build time)
ARG GIT_SHA=unknown

RUN npm install -g pnpm@9.15.1

WORKDIR /app

# Copy workspace config first (for better layer caching)
# Use Docker-specific workspace that only includes packages we need
COPY pnpm-workspace.yaml ./
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
COPY shared/pages/package.json ./shared/pages/
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
COPY shared/styles ./shared/styles

# Build client-side bundles only (Vite handles TypeScript)
# SSG must run after web build to read CSS manifest
RUN pnpm --filter @doc-platform/web build && \
    pnpm --filter @doc-platform/ssg build

# Create version.txt with git SHA
RUN echo "${GIT_SHA}" > /app/web/dist/version.txt

# ===== PRODUCTION RUN STAGE =====
# Node 25 runs TypeScript directly, no build step needed for server
FROM node:25-alpine AS runner

RUN npm install -g pnpm@9.15.1

WORKDIR /app

# Download AWS RDS CA bundle for SSL certificate verification
RUN wget -O /app/rds-ca-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

# Copy workspace config and package files
COPY pnpm-workspace.yaml ./
COPY package.json pnpm-lock.yaml ./
COPY shared/core/package.json ./shared/core/
COPY shared/db/package.json ./shared/db/
COPY shared/auth/package.json ./shared/auth/
COPY frontend/package.json ./frontend/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy source code for server (Node 25 runs TypeScript directly)
COPY tsconfig.json ./
COPY shared/core ./shared/core
COPY shared/db ./shared/db
COPY shared/auth ./shared/auth
COPY frontend ./frontend

# Copy built client-side bundles from builder
COPY --from=builder /app/web/dist ./frontend/static
COPY --from=builder /app/ssg/dist ./frontend/static/ssg

WORKDIR /app/frontend

EXPOSE 3000

CMD ["node", "src/index.ts"]
