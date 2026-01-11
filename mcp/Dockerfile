# ===== DEV TARGET =====
# Used by docker-compose for local development
FROM node:25-alpine AS dev

RUN npm install -g pnpm@9.15.1

WORKDIR /app

# Copy workspace config and package files
COPY mcp/pnpm-workspace.docker.yaml ./pnpm-workspace.yaml
COPY package.json pnpm-lock.yaml ./
COPY shared/core/package.json ./shared/core/
COPY shared/db/package.json ./shared/db/
COPY mcp/package.json ./mcp/
COPY tsconfig.json ./

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Download AWS RDS CA bundle for SSL certificate verification
RUN wget -O /app/rds-ca-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

# Source code is mounted at runtime via docker-compose volumes
EXPOSE 3002

CMD ["node", "--experimental-transform-types", "--watch", "mcp/src/index.ts"]

# ===== PRODUCTION STAGE =====
# Node 25 runs TypeScript natively, no build step needed
FROM node:25-alpine AS runner

RUN npm install -g pnpm@9.15.1

WORKDIR /app

# Download AWS RDS CA bundle for SSL certificate verification
RUN wget -O /app/rds-ca-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

# Copy workspace config
COPY mcp/pnpm-workspace.docker.yaml ./pnpm-workspace.yaml
COPY package.json pnpm-lock.yaml ./
COPY shared/core/package.json ./shared/core/
COPY shared/db/package.json ./shared/db/
COPY mcp/package.json ./mcp/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy source code (Node 25 runs TypeScript directly)
COPY tsconfig.json ./
COPY shared/core ./shared/core
COPY shared/db ./shared/db
COPY mcp ./mcp

EXPOSE 3002

ENV PORT=3002

CMD ["node", "--experimental-transform-types", "mcp/src/index.ts"]
