# Authentication Specification

This specification defines the authentication and authorization architecture for doc-platform.

---

## Overview

The authentication system handles:
1. **User accounts** - Email/password via AWS Cognito
2. **Session management** - Redis-backed sessions shared across containers
3. **Storage provider connections** - GitHub OAuth (others in future)
4. **MCP authentication** - OAuth 2.1 + PKCE for Claude Code

Key principles:
- Users own their accounts (not tied to GitHub)
- GitHub is a connected storage provider, not identity
- Email is NOT the primary key
- Backend proxies all GitHub API calls
- **Protected SPA** - Static files require authentication (not public)

---

## Architecture

### Container Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Load Balancer (ALB)                   │
│                                                          │
│    /*        → Frontend Container                        │
│    /api/*    → API Container                             │
│    /auth/*   → API Container                             │
└───────────────────────┬──────────────────────────────────┘
                        │
         ┌──────────────┴──────────────┐
         │                             │
┌────────▼────────┐          ┌────────▼────────┐
│    Frontend     │          │      API        │
│    (Hono)       │          │    (Hono)       │
│                 │          │                 │
│ Serves static   │          │ /api/* routes   │
│ files + SPA     │          │ /auth/* routes  │
│                 │          │ /oauth/* routes │
└────────┬────────┘          └────────┬────────┘
         │                             │
         │    ┌─────────────┐          │
         └────►   Redis     ◄──────────┘
              │ (sessions)  │
              └─────────────┘
                    │
         ┌──────────┴──────────┐
         │                     │
┌────────▼────────┐   ┌───────▼────────┐
│   PostgreSQL    │   │    Cognito     │
│   (users, etc)  │   │  (identity)    │
└─────────────────┘   └────────────────┘
```

### Session-Based Authentication

Both containers share authentication state via Redis sessions:

1. **Login**: User authenticates via API → Cognito validates → API creates Redis session
2. **Session cookie**: API sets HttpOnly session ID cookie
3. **Frontend requests**: Hono middleware checks session in Redis before serving files
4. **API requests**: Same middleware validates session for API calls
5. **Logout**: Session deleted from Redis, cookie cleared

**Why sessions over JWT-only:**
- Both containers validate auth with simple Redis lookup
- Cognito tokens stay server-side (more secure)
- Instant session revocation (delete from Redis)
- Simpler token refresh (API handles it)

---

## User Identity Model

### Database Schema

```sql
-- Users table (primary identity)
CREATE TABLE users (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	cognito_sub VARCHAR(255) UNIQUE NOT NULL,
	display_name VARCHAR(255) NOT NULL,
	avatar_url TEXT,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User emails (multiple per user)
CREATE TABLE user_emails (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	email VARCHAR(255) NOT NULL,
	is_primary BOOLEAN DEFAULT FALSE,
	is_verified BOOLEAN DEFAULT FALSE,
	verified_at TIMESTAMP WITH TIME ZONE,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
	UNIQUE(email)
);

-- Ensure one primary email per user
CREATE UNIQUE INDEX idx_user_primary_email
	ON user_emails(user_id)
	WHERE is_primary = TRUE;

-- GitHub connections
CREATE TABLE github_connections (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	github_user_id VARCHAR(255) NOT NULL,
	github_username VARCHAR(255) NOT NULL,
	access_token TEXT NOT NULL,  -- Encrypted with KMS
	refresh_token TEXT,          -- Encrypted with KMS
	token_expires_at TIMESTAMP WITH TIME ZONE,
	scopes TEXT[] NOT NULL,
	connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
	UNIQUE(user_id),
	UNIQUE(github_user_id)
);

-- MCP OAuth tokens
CREATE TABLE mcp_tokens (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	client_id VARCHAR(255) NOT NULL,
	access_token_hash VARCHAR(255) NOT NULL,
	refresh_token_hash VARCHAR(255),
	scopes TEXT[] NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
	UNIQUE(access_token_hash)
);

-- OAuth authorization codes (short-lived)
CREATE TABLE oauth_codes (
	code VARCHAR(255) PRIMARY KEY,
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	client_id VARCHAR(255) NOT NULL,
	code_challenge VARCHAR(255) NOT NULL,
	code_challenge_method VARCHAR(10) NOT NULL,
	scopes TEXT[] NOT NULL,
	redirect_uri TEXT NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);
```

### Redis Session Structure

```
session:{session_id}:
  user_id: UUID
  cognito_access_token: string
  cognito_refresh_token: string
  cognito_expires_at: timestamp
  created_at: timestamp
  last_accessed: timestamp

TTL: 30 days (matches Cognito refresh token)
```

---

## AWS Cognito Setup

### User Pool Configuration

| Setting | Value |
|---------|-------|
| Self-signup | Enabled |
| Sign-in aliases | Email only |
| Auto-verify | Email |
| Password policy | Min 8, upper, lower, digit |
| MFA | Optional (TOTP only) |
| Account recovery | Email only |

### App Client Configuration

| Setting | Value |
|---------|-------|
| Auth flows | USER_SRP_AUTH, USER_PASSWORD_AUTH |
| OAuth flows | Authorization code grant |
| OAuth scopes | email, openid, profile |
| Callback URLs | localhost:3000, app.doc-platform.com |
| Generate secret | No (public client) |

### Post-Confirmation Trigger

When a user confirms their email in Cognito:
1. Lambda trigger fires
2. Creates user record in our database with Cognito sub
3. Creates user_emails record with verified email

---

## Authentication Flows

### 1. User Registration

```
Browser                        API                         Cognito
   │                            │                            │
   │ POST /auth/signup          │                            │
   │ {email, password, name}    │                            │
   │───────────────────────────►│                            │
   │                            │                            │
   │                            │ SignUp                     │
   │                            │───────────────────────────►│
   │                            │◄───────────────────────────│
   │                            │                            │
   │◄───────────────────────────│                            │
   │ {message: "Check email"}   │                            │
   │                            │                            │
   │ User clicks email link     │                            │
   │                            │                            │
   │ GET /auth/verify?code=xxx  │                            │
   │───────────────────────────►│                            │
   │                            │ ConfirmSignUp              │
   │                            │───────────────────────────►│
   │                            │                            │
   │                            │ Post-confirmation trigger  │
   │                            │ creates DB records         │
   │                            │◄───────────────────────────│
   │◄───────────────────────────│                            │
   │ Redirect to login          │                            │
```

### 2. User Login (Session-Based)

```
Browser                        API                    Cognito        Redis
   │                            │                        │             │
   │ POST /auth/login           │                        │             │
   │ {email, password}          │                        │             │
   │───────────────────────────►│                        │             │
   │                            │                        │             │
   │                            │ InitiateAuth           │             │
   │                            │───────────────────────►│             │
   │                            │◄───────────────────────│             │
   │                            │ {tokens}               │             │
   │                            │                        │             │
   │                            │ Create session         │             │
   │                            │────────────────────────────────────►│
   │                            │                        │             │
   │◄───────────────────────────│                        │             │
   │ Set-Cookie: session_id     │                        │             │
   │ {user}                     │                        │             │
```

### 3. Authenticated Request (Frontend or API)

```
Browser                     Frontend/API              Redis
   │                            │                       │
   │ GET /some-page             │                       │
   │ Cookie: session_id=xxx     │                       │
   │───────────────────────────►│                       │
   │                            │                       │
   │                            │ GET session:xxx       │
   │                            │──────────────────────►│
   │                            │◄──────────────────────│
   │                            │ {user_id, tokens}     │
   │                            │                       │
   │                            │ (valid session)       │
   │◄───────────────────────────│                       │
   │ Response                   │                       │
```

### 4. Token Refresh (Transparent)

When Cognito access token expires, API automatically refreshes:
1. Middleware detects expired token in session
2. API calls Cognito REFRESH_TOKEN_AUTH
3. Updates session in Redis with new tokens
4. Request proceeds normally

### 5. Logout

```
Browser                        API                         Redis
   │                            │                            │
   │ POST /auth/logout          │                            │
   │ Cookie: session_id=xxx     │                            │
   │───────────────────────────►│                            │
   │                            │                            │
   │                            │ DEL session:xxx            │
   │                            │───────────────────────────►│
   │                            │                            │
   │◄───────────────────────────│                            │
   │ Clear-Cookie: session_id   │                            │
   │ Redirect to /login         │                            │
```

---

## GitHub Connection

### OAuth Flow

```
Browser                        API                         GitHub
   │                            │                            │
   │ GET /auth/github/connect   │                            │
   │───────────────────────────►│                            │
   │                            │                            │
   │                            │ Generate state token       │
   │                            │ Store in Redis session     │
   │                            │                            │
   │◄───────────────────────────│                            │
   │ Redirect to:               │                            │
   │ github.com/login/oauth     │                            │
   │ ?client_id=xxx             │                            │
   │ &scope=repo,user:email     │                            │
   │ &state=xxx                 │                            │
   │────────────────────────────────────────────────────────►│
   │                            │                            │
   │ User authorizes            │                            │
   │                            │                            │
   │◄────────────────────────────────────────────────────────│
   │ Redirect to callback       │                            │
   │ ?code=xxx&state=xxx        │                            │
   │                            │                            │
   │ GET /auth/github/callback  │                            │
   │ ?code=xxx&state=xxx        │                            │
   │───────────────────────────►│                            │
   │                            │                            │
   │                            │ Verify state from session  │
   │                            │                            │
   │                            │ POST /access_token         │
   │                            │ {code, client_secret}      │
   │                            │───────────────────────────►│
   │                            │◄───────────────────────────│
   │                            │ {access_token}             │
   │                            │                            │
   │                            │ GET /user                  │
   │                            │───────────────────────────►│
   │                            │◄───────────────────────────│
   │                            │ {id, login, ...}           │
   │                            │                            │
   │                            │ Encrypt & store token      │
   │                            │ Create github_connection   │
   │                            │                            │
   │◄───────────────────────────│                            │
   │ Redirect to /settings      │                            │
   │ GitHub connected!          │                            │
```

### Token Encryption

GitHub tokens are encrypted at rest:
- Use AWS KMS for encryption/decryption
- Key rotation enabled
- Tokens decrypted only when calling GitHub API

### GitHub API Proxy

All GitHub API calls go through our backend:
1. Frontend requests /api/github/* endpoint
2. Backend retrieves user's encrypted token
3. Backend decrypts token via KMS
4. Backend calls GitHub API with token
5. Backend returns response to frontend

**Important**: Browser NEVER has access to GitHub token.

### Required GitHub Scopes

| Scope | Purpose |
|-------|---------|
| `repo` | Full access to private and public repositories |
| `user:email` | Read user email addresses (for matching) |

---

## MCP Authentication (OAuth 2.1 + PKCE)

### OAuth Metadata Endpoint

`GET /.well-known/oauth-authorization-server`

Returns:
- issuer
- authorization_endpoint
- token_endpoint
- revocation_endpoint
- scopes_supported: docs:read, docs:write, tasks:read, tasks:write
- response_types_supported: code
- grant_types_supported: authorization_code, refresh_token
- code_challenge_methods_supported: S256

### Authorization Flow

1. Claude Code generates PKCE code_verifier and code_challenge
2. Redirects to /oauth/authorize with:
   - client_id
   - redirect_uri
   - response_type=code
   - scope
   - state
   - code_challenge
   - code_challenge_method=S256
3. User logs in (if not already, via session)
4. Backend generates authorization code
5. Redirects back with code and state
6. Claude Code exchanges code for tokens via /oauth/token:
   - code
   - code_verifier
   - grant_type=authorization_code
7. Backend verifies PKCE challenge
8. Returns access_token and refresh_token

### MCP Token Scopes

| Scope | Description | Allows |
|-------|-------------|--------|
| `docs:read` | Read documents | get_document, search_docs, list_documents |
| `docs:write` | Modify documents | create_document, update_document |
| `tasks:read` | Read tasks | get_task, get_epic, get_backlog |
| `tasks:write` | Modify tasks | create_task, update_task |

---

## Shared Auth Package

Both containers use `@doc-platform/auth` for session validation:

```
shared/auth/
├── src/
│   ├── index.ts           # Main exports
│   ├── session.ts         # Redis session management
│   ├── middleware.ts      # Hono auth middleware
│   ├── cognito.ts         # Cognito client (API only)
│   └── types.ts           # Session types
├── package.json
└── tsconfig.json
```

### Session Middleware

```typescript
// Used by both frontend and API containers
import { authMiddleware } from '@doc-platform/auth';

app.use('*', authMiddleware({
  redis: redisClient,
  excludePaths: ['/auth/login', '/auth/signup', '/health'],
  onUnauthenticated: (c) => c.redirect('/login'),
}));
```

---

## Token Lifetimes

| Token | Lifetime | Refresh |
|-------|----------|---------|
| Session | 30 days | Sliding window on access |
| Cognito Access Token | 1 hour | Auto-refresh by API |
| Cognito ID Token | 1 hour | Auto-refresh by API |
| Cognito Refresh Token | 30 days | Re-authenticate |
| MCP Access Token | 1 hour | Via refresh token |
| MCP Refresh Token | 30 days | Re-authorize |
| GitHub Access Token | No expiry* | N/A |

*GitHub tokens don't expire but can be revoked by user.

---

## Security Considerations

### Session Security

- Session ID: Cryptographically random, 256-bit
- Cookie flags: HttpOnly, Secure, SameSite=Lax
- Session stored server-side (Redis), not in cookie
- Sliding expiration: Session TTL refreshed on each access

### CSRF Protection

- Generate CSRF token per session
- Validate on all state-changing requests (POST, PUT, DELETE)
- Token sent via X-CSRF-Token header

### Rate Limiting

| Endpoint | Limit |
|----------|-------|
| /auth/login | 5 attempts per 15 minutes |
| /auth/signup | 3 per hour per IP |
| General API | 100 requests per minute |

---

## Infrastructure (CDK)

### Components to Deploy

| Resource | Purpose |
|----------|---------|
| ECS Fargate (Frontend) | Hono server for static files |
| ECS Fargate (API) | Hono server for API |
| ElastiCache Redis | Session storage |
| Aurora PostgreSQL | User data, connections |
| Cognito User Pool | User authentication |
| Cognito App Client | Web app authentication |
| KMS Key | GitHub token encryption |
| Lambda (Post-Confirmation) | Create user records on signup |
| ALB | Load balancer with path routing |

### Container Configuration

```yaml
# docker-compose.yml (local dev)
services:
  frontend:
    build: ./frontend
    ports: ["3000:3000"]
    environment:
      REDIS_URL: redis://redis:6379
    depends_on: [redis]

  api:
    build: ./api
    ports: ["3001:3001"]
    environment:
      REDIS_URL: redis://redis:6379
      DATABASE_URL: postgresql://...
      COGNITO_USER_POOL_ID: ...
      COGNITO_CLIENT_ID: ...
    depends_on: [redis, db]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  db:
    image: postgres:16-alpine
    # ...
```

---

## API Routes Summary

| Method | Path | Auth | Container | Description |
|--------|------|------|-----------|-------------|
| POST | /auth/signup | None | API | Create account |
| POST | /auth/login | None | API | Login, create session |
| POST | /auth/logout | Session | API | Logout, destroy session |
| GET | /auth/me | Session | API | Get current user |
| GET | /auth/github/connect | Session | API | Start GitHub OAuth |
| GET | /auth/github/callback | Session | API | GitHub OAuth callback |
| DELETE | /auth/github | Session | API | Disconnect GitHub |
| GET | /oauth/authorize | Session | API | MCP OAuth authorize |
| POST | /oauth/token | None | API | MCP token exchange |
| POST | /oauth/revoke | None | API | Revoke MCP token |
| GET | /* | Session | Frontend | Serve static files |

---

## File Structure

```
shared/auth/
├── src/
│   ├── index.ts           # Main exports
│   ├── session.ts         # Redis session CRUD
│   ├── middleware.ts      # Hono auth middleware
│   ├── cognito.ts         # Cognito client
│   └── types.ts           # Session/user types

api/src/
├── auth/
│   ├── routes.ts          # Auth endpoints
│   ├── github.ts          # GitHub OAuth
│   └── mcp-oauth.ts       # MCP OAuth endpoints
├── middleware/
│   ├── csrf.ts            # CSRF protection
│   └── rate-limit.ts      # Rate limiting
└── utils/
    └── encryption.ts      # KMS encryption

frontend/src/
├── index.ts               # Hono server entry
├── middleware/
│   └── auth.ts            # Uses @doc-platform/auth
└── static/                # Built SPA files
```
