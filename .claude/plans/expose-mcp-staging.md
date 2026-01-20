# Expose MCP Service at staging.specboard.io

## Overview

Expose the MCP server through the ALB at `https://staging.specboard.io/mcp` with OAuth 2.1 authentication, enabling Claude Code to connect to the staging planning system.

## Approach

1. **Convert MCP to Hono** - Use `@hono/mcp` for native streaming support
2. **Integrate OAuth middleware** - Use existing `mcpAuthMiddleware()` from `@doc-platform/auth`
3. **Expose through ALB** - Add target group and listener rules in CDK
4. **Rename UI** - Change "Authorized Apps" to "Authorized MCP Sessions"
5. **Add epic to status.md** - Track this work

## Files to Modify

| File | Changes |
|------|---------|
| `mcp/src/index.ts` | Convert to Hono with `@hono/mcp` |
| `mcp/package.json` | Add `hono`, `@hono/node-server`, `@hono/mcp` |
| `infra/lib/doc-platform-stack.ts` | Target group, listener rule, security group |
| `web/src/routes/settings/AuthorizedApps.tsx` | Rename to "Authorized MCP Sessions" |
| `docs/status.md` | Add epic for this work |

---

## Implementation

### 1. Add Dependencies to MCP Package

**File:** `mcp/package.json`

Add:
- `hono`
- `@hono/node-server`
- `@hono/mcp`

### 2. Convert MCP Server to Hono

**File:** `mcp/src/index.ts`

- Replace `http.createServer()` with Hono app
- Use `@hono/mcp` `StreamableHTTPTransport` for streaming
- Add `mcpAuthMiddleware()` from `@doc-platform/auth` to `/mcp` routes
- Keep `/health` unauthenticated (ALB health checks)
- Preserve session management with transports Map

### 3. Infrastructure Changes (CDK)

**File:** `infra/lib/doc-platform-stack.ts`

a) Add ALB → MCP security group rule (~line 370):
```typescript
mcpSecurityGroup.addIngressRule(
  ec2.Peer.securityGroupId(alb.connections.securityGroups[0]!.securityGroupId),
  ec2.Port.tcp(3002),
  'Allow ALB to MCP'
);
```

b) Create MCP target group (~line 927):
```typescript
const mcpTargetGroup = new elbv2.ApplicationTargetGroup(this, 'McpTargetGroup', {
  vpc,
  port: 3002,
  protocol: elbv2.ApplicationProtocol.HTTP,
  targetType: elbv2.TargetType.IP,
  healthCheck: {
    path: '/health',
    interval: cdk.Duration.seconds(30),
    healthyThresholdCount: 2,
    unhealthyThresholdCount: 3,
  },
});
```

c) Capture mcpService reference and attach to target group

d) Add listener rule (priority 15, before default):
```typescript
httpsListener.addTargetGroups('McpRoutes', {
  targetGroups: [mcpTargetGroup],
  priority: 15,
  conditions: [
    elbv2.ListenerCondition.pathPatterns(['/mcp', '/mcp/*']),
  ],
});
```

### 4. Rename UI Section

**File:** `web/src/routes/settings/AuthorizedApps.tsx`

- Change title from "Authorized Apps" to "Authorized MCP Sessions"
- Update description text accordingly

### 5. Add Epic to Status Doc

**File:** `docs/status.md`

Add epic to "In Progress Epics" section.

---

## Verification

### Local Testing
```bash
docker compose build mcp && docker compose up
curl http://localhost:3002/health  # Should return {"status":"ok"}
curl -X POST http://localhost:3002/mcp  # Should return 401
```

### After Staging Deployment
```bash
curl https://staging.specboard.io/health
curl -X POST https://staging.specboard.io/mcp  # Should return 401
```

### Connect Claude Code
```bash
claude mcp add staging-mcp https://staging.specboard.io/mcp
# Opens browser for OAuth consent
# After approval, MCP tools available
/mcp  # Verify connection
```

---

## Security

- OAuth 2.1 + PKCE (MCP spec recommended)
- Tokens hashed (SHA-256) in PostgreSQL
- Access tokens: 1 hour TTL
- Refresh tokens: 30 days TTL
- Scopes: `docs:read`, `docs:write`, `tasks:read`, `tasks:write`
- Health endpoint unauthenticated (ALB requirement)
- HTTPS via ALB TLS termination
- Streaming via `@hono/mcp` StreamableHTTPTransport
