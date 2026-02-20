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
│  Browser        │     │  API Server     │     │  Error Tracking │
│  (web)          │────►│  /api/metrics   │────►│  Service        │
│                 │     │  (envelope)     │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
  Simple JSON             Wraps in envelope
                               │
                               │ CloudWatch Logs
                               ▼
                        ┌─────────────────┐
                        │  CloudWatch     │
                        │  Alarms         │
                        └─────────────────┘
```

### Why Tunnel Through Our API?

- No third-party requests from user browsers
- Bypasses ad blockers
- Privacy-conscious design
- Error tracking service details hidden from frontend code

### Minimal Frontend Bundle

The frontend uses `@specboard/telemetry`, a minimal (~1KB) package that:
- Captures unhandled errors and promise rejections
- Sends simple JSON to `/api/metrics`
- Uses `navigator.sendBeacon()` for reliable delivery
- Contains no third-party SDK code

## Implementation

### 1. Frontend Telemetry

**Package:** `shared/telemetry`

Minimal error capture and reporting:

```typescript
import { init } from '@specboard/telemetry';

init({
  enabled: import.meta.env.WEB_ERROR_REPORTING_ENABLED === 'true',
  environment: import.meta.env.MODE,
});
```

The package sends simple JSON to `/api/metrics`:

```json
{
  "name": "TypeError",
  "message": "Cannot read property 'x' of undefined",
  "stack": "TypeError: Cannot read property...",
  "timestamp": 1703945123456,
  "url": "https://example.com/app",
  "userAgent": "Mozilla/5.0...",
  "context": {
    "environment": "production"
  }
}
```

### 2. API Metrics Endpoint

**Location:** `api/src/index.ts`
**Route:** `POST /api/metrics`

The endpoint receives simple JSON from the frontend, wraps it in the error tracking service's envelope format, and forwards it:

```typescript
app.post('/api/metrics', async (c) => {
  const dsn = process.env.ERROR_REPORTING_DSN;
  if (!dsn) return c.text('ok');

  const report = await c.req.json();

  // Parse DSN, wrap in envelope format, forward to service
  // (implementation details hidden from frontend)
});
```

### 3. CloudWatch Alarms

**Location:** `infra/lib/specboard-stack.ts`

Alarms for resource utilization:
- CPU > 80% for 5 minutes
- Memory > 80% for 5 minutes
- HTTP 5xx errors > 10 in 5 minutes

### 4. Audit Logging

Log auth events to stdout (captured by CloudWatch):

| Event | Data Logged |
|-------|-------------|
| Login success | timestamp, userId, username |
| Login failure | timestamp, identifier, reason |
| Logout | timestamp, userId |
| Signup success | timestamp, userId, username |

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

**Frontend (web/.env):**
```
WEB_ERROR_REPORTING_ENABLED=true
```

**Backend (api/.env):**
```
ERROR_REPORTING_DSN=https://key@host/project
```

### Deployment (AWS Secrets Manager)

For production, store `ERROR_REPORTING_DSN` in Secrets Manager and reference it in the ECS task definition.

## What We're NOT Doing

- No APM/distributed tracing (overkill for current scale)
- No log aggregation service (CloudWatch is sufficient)
- No custom metrics beyond CloudWatch defaults
- No real-time alerting beyond CloudWatch Alarms
- No session replay (can add later if needed)
- No third-party SDK in frontend code

## Future Considerations

- Add performance monitoring when needed
- Add user behavior analytics when product-market fit is established
- Consider BetterStack or similar for log aggregation if CloudWatch becomes insufficient
