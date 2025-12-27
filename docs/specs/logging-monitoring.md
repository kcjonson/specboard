# Logging & Monitoring Specification

## Overview

Minimal observability stack focused on catching errors and understanding basic system health without over-engineering or adding many external services.

## Goals

1. **Error tracking** - Know when things break (frontend and backend)
2. **Resource monitoring** - Avoid surprise costs, catch performance issues
3. **Audit logging** - Track auth events for security and debugging
4. **Uptime monitoring** - Know when the system is down (external)

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Browser        │     │  API Server     │     │  Sentry.io      │
│  (planning-web) │────►│  /api/metrics   │────►│                 │
│                 │     │  (tunnel)       │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               │ CloudWatch Logs
                               ▼
                        ┌─────────────────┐
                        │  CloudWatch     │
                        │  Alarms         │
                        └─────────────────┘
```

### Why Tunnel Sentry?

- No third-party requests from user browsers
- Bypasses ad blockers that block Sentry
- Privacy-conscious design
- Single external dependency (Sentry) for error tracking

## Implementation

### 1. Sentry Tunnel Endpoint

**Location:** `api/src/index.ts`
**Route:** `POST /api/metrics`

The endpoint receives Sentry envelope data from the frontend and forwards it to Sentry's ingestion API. This keeps Sentry's DSN server-side and prevents direct browser→Sentry communication.

```typescript
app.post('/api/metrics', async (c) => {
  const envelope = await c.req.text();
  const header = envelope.split('\n')[0];
  const dsn = JSON.parse(header).dsn;
  const projectId = new URL(dsn).pathname.slice(1);

  await fetch(`https://sentry.io/api/${projectId}/envelope/`, {
    method: 'POST',
    body: envelope,
  });

  return c.text('ok');
});
```

### 2. Frontend Sentry SDK

**Location:** `planning-web/src/main.tsx`

Initialize Sentry with tunnel configuration pointing to our API:

```typescript
import * as Sentry from '@sentry/browser';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  tunnel: '/api/metrics',
  environment: import.meta.env.MODE,
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
});
```

### 3. Backend Sentry SDK

**Location:** `api/src/index.ts`

Initialize Sentry for Node.js to catch backend errors:

```typescript
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  enabled: !!process.env.SENTRY_DSN,
});
```

### 4. CloudWatch Alarms

**Location:** `infra/lib/doc-platform-stack.ts`

Alarms for resource utilization:
- CPU > 80% for 5 minutes
- Memory > 80% for 5 minutes
- HTTP 5xx errors > 10 in 5 minutes

### 5. Audit Logging

Log auth events to stdout (captured by CloudWatch):

| Event | Data Logged |
|-------|-------------|
| Login success | timestamp, userId, email |
| Login failure | timestamp, email, reason |
| Logout | timestamp, userId |
| Session expired | timestamp, userId |

Format: Structured JSON for CloudWatch Logs Insights queries.

```typescript
function logAuthEvent(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({
    type: 'auth',
    event,
    timestamp: new Date().toISOString(),
    ...data,
  }));
}
```

## Configuration

### Environment Variables

**Frontend (planning-web/.env):**
```
VITE_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

**Backend (api/.env):**
```
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

### Sentry Project Setup

1. Create a Sentry project (Browser JavaScript)
2. Get the DSN from Project Settings → Client Keys
3. Configure the DSN in environment variables
4. Sentry will receive errors from both frontend (via tunnel) and backend (direct)

## What We're NOT Doing

- No APM/distributed tracing (overkill for current scale)
- No log aggregation service (CloudWatch is sufficient)
- No custom metrics beyond CloudWatch defaults
- No real-time alerting beyond CloudWatch Alarms
- No session replay (can add later if needed)

## Future Considerations

- Add Sentry Performance monitoring when needed
- Add user behavior analytics when product-market fit is established
- Consider BetterStack or similar for log aggregation if CloudWatch becomes insufficient
