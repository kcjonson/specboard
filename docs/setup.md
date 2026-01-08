# Local Development Setup

This guide covers setting up doc-platform for local development.

---

## Prerequisites

- **Node.js** 20+
- **pnpm** 8+
- **Docker** and **Docker Compose**

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Start all services
docker compose up

# Access the app
open http://localhost
```

---

## Docker Compose Configuration

### Base Configuration (`docker-compose.yml`)

The base configuration includes:

| Service | Port | Description |
|---------|------|-------------|
| nginx | 80 | Reverse proxy, routes to frontend/api |
| db | 5432 | PostgreSQL 16 |
| redis | 6379 | Session storage |
| api | 3001 | Backend API (Hono) |
| frontend | 3000 | Frontend server (Hono, serves SPA) |
| mcp | 3002 | MCP server |

### Local Overrides (`docker-compose.override.yml`)

Create this file for local-only configuration that shouldn't be committed:

```yaml
# Local development overrides
# This file is automatically merged with docker-compose.yml

services:
  api:
    volumes:
      - .:/host/doc-platform
    environment:
      # Local dev encryption key for user API keys (AI chat feature)
      # Generate a real key with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
      API_KEY_ENCRYPTION_KEY: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

#### Volume Mount

The host volume mount (`- .:/host/doc-platform`) enables local file operations from within the API container. This is required for Git operations on local repositories.

#### API Key Encryption

The `API_KEY_ENCRYPTION_KEY` is required for the AI chat feature, which stores user Anthropic API keys encrypted in the database.

**To generate a secure key:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

In production, this key is stored in AWS Secrets Manager and injected automatically.

---

## Hybrid Development Mode

For faster frontend iteration, run only the backend services in Docker:

```bash
# Start backend services only
docker compose up db redis api

# Run frontend with hot reload
pnpm --filter web dev
```

---

## Database

### Running Migrations

Migrations run automatically when the API container starts. To run manually:

```bash
# From the api container
docker compose exec api pnpm migrate
```

### Connecting Directly

```bash
# psql connection
psql postgresql://dev:dev@localhost:5432/doc_platform

# Or via Docker
docker compose exec db psql -U dev -d doc_platform
```

---

## Common Commands

```bash
# Install dependencies
pnpm install

# Start all services
docker compose up

# Start in detached mode
docker compose up -d

# View logs
docker compose logs -f api

# Rebuild after code changes
docker compose build api

# Run tests
pnpm test

# Lint code
pnpm lint

# Build packages
pnpm build
```

---

## Staging/Production Setup

### First-Time Deployment

After the first CDK deployment, you must manually set the API key encryption secret:

```bash
# Generate and set the encryption key
aws secretsmanager put-secret-value \
  --secret-id doc-platform/api-key-encryption \
  --secret-string "$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
  --region us-west-2
```

This is required for the AI chat feature to work. The secret must be exactly 64 hex characters (32 bytes).

---

## Troubleshooting

### Port Conflicts

If you see port binding errors, check for existing services:

```bash
# Check what's using port 80
lsof -i :80

# Stop existing docker containers
docker compose down
```

### Database Connection Issues

```bash
# Check if postgres is healthy
docker compose ps

# View postgres logs
docker compose logs db
```

### Rebuilding After Package Changes

After modifying shared packages, rebuild:

```bash
pnpm build
docker compose build api frontend
docker compose up
```
