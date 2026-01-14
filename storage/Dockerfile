# ===== DEV TARGET =====
# Used by docker-compose for local development with hot reloading
# Source and deps are mounted/installed at runtime
# No RDS CA bundle needed - dev uses local databases without SSL
FROM node:25-alpine AS dev

WORKDIR /app

EXPOSE 3003

CMD ["node", "--watch", "storage/src/index.ts"]

# ===== PRODUCTION STAGE =====
# Node 25 runs TypeScript directly, no build step needed
FROM node:25-alpine AS runner

WORKDIR /app

# Download AWS RDS CA bundle for SSL certificate verification
RUN wget -O /app/rds-ca-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

# Copy workspace config and package files
COPY package.json package-lock.json ./
COPY storage/package.json ./storage/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy source code (Node 25 runs TypeScript directly)
COPY tsconfig.json ./
COPY storage ./storage

EXPOSE 3003

CMD ["node", "storage/src/index.ts"]
