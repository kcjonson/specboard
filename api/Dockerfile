# ===== DEV TARGET =====
# Used by docker-compose for local development with hot reloading
# Source and deps are mounted/installed at runtime
FROM node:25-alpine AS dev

RUN apk add --no-cache git

WORKDIR /app

# Download AWS RDS CA bundle for SSL certificate verification
RUN wget -O /app/rds-ca-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

EXPOSE 3001

CMD ["node", "--watch", "api/src/index.ts"]

# ===== PRODUCTION STAGE =====
# Node 25 runs TypeScript directly, no build step needed
FROM node:25-alpine AS runner

# Install git for project storage git operations
RUN apk add --no-cache git

WORKDIR /app

# Download AWS RDS CA bundle for SSL certificate verification
RUN wget -O /app/rds-ca-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

# Copy workspace config and package files
COPY package.json package-lock.json ./
COPY shared/core/package.json ./shared/core/
COPY shared/db/package.json ./shared/db/
COPY shared/auth/package.json ./shared/auth/
COPY shared/email/package.json ./shared/email/
COPY api/package.json ./api/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy source code (Node 25 runs TypeScript directly)
COPY tsconfig.json ./
COPY shared/core ./shared/core
COPY shared/db ./shared/db
COPY shared/auth ./shared/auth
COPY shared/email ./shared/email
COPY api ./api

EXPOSE 3001

CMD ["node", "api/src/index.ts"]
