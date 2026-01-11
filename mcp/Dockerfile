# ===== DEV TARGET =====
# Used by docker-compose for local development
# Source and deps are mounted/installed at runtime
FROM node:25-alpine AS dev

WORKDIR /app

# Download AWS RDS CA bundle for SSL certificate verification
RUN wget -O /app/rds-ca-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

EXPOSE 3002

CMD ["node", "--watch", "mcp/src/index.ts"]

# ===== PRODUCTION STAGE =====
# Node 25 runs TypeScript natively, no build step needed
FROM node:25-alpine AS runner

WORKDIR /app

# Download AWS RDS CA bundle for SSL certificate verification
RUN wget -O /app/rds-ca-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

# Copy workspace config
COPY package.json package-lock.json ./
COPY shared/core/package.json ./shared/core/
COPY shared/db/package.json ./shared/db/
COPY mcp/package.json ./mcp/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy source code (Node 25 runs TypeScript directly)
COPY tsconfig.json ./
COPY shared/core ./shared/core
COPY shared/db ./shared/db
COPY mcp ./mcp

EXPOSE 3002

ENV PORT=3002

CMD ["node", "mcp/src/index.ts"]
