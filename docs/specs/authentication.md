# Authentication Specification

This specification defines the authentication and authorization architecture for Specboard.

---

## Overview

The authentication system handles:
1. **User accounts** - Email/password with bcrypt hashing (PostgreSQL)
2. **Session management** - Redis-backed sessions shared across containers
3. **GitHub connection** - OAuth for repo access and optional login
4. **MCP authentication** - OAuth 2.1 + PKCE for Claude Code

Key principles:
- Users own their accounts (not tied to GitHub)
- GitHub is a connected storage provider (and optional identity)
- Email is NOT the primary key
- Backend proxies all GitHub API calls
- **Protected SPA** - Static files require authentication (not public)

---

## Architecture

### Container Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Load Balancer (ALB)                       │
│                                                              │
│    /*        → Frontend Container                            │
│    /api/*    → API Container                                 │
└───────────────────────┬──────────────────────────────────────┘
                        │
         ┌──────────────┴──────────────┐
         │                             │
┌────────▼────────┐          ┌────────▼────────┐
│    Frontend     │          │      API        │
│    (Hono)       │          │    (Hono)       │
│                 │          │                 │
│ Serves static   │          │ /api/* routes   │
│ files + SPA     │          │                 │
└────────┬────────┘          └────────┬────────┘
         │                             │
         │    ┌─────────────┐          │
         └────►   Redis     ◄──────────┘
              │ (sessions)  │
              └─────────────┘
                    │
              ┌─────▼─────┐
              │PostgreSQL │
              │ (users)   │
              └───────────┘
```

### Session-Based Authentication

Both containers share authentication state via Redis sessions:

1. **Login**: User authenticates via API → bcrypt validates → API creates Redis session
2. **Session cookie**: API sets HttpOnly session ID cookie
3. **Frontend requests**: Hono middleware checks session in Redis before serving files
4. **API requests**: Same middleware validates session for API calls
5. **Logout**: Session deleted from Redis, cookie cleared

---

## User Identity Model

### Database Schema

```sql
-- Users table (primary identity)
CREATE TABLE users (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	username VARCHAR(255) NOT NULL UNIQUE,  -- Immutable after creation
	first_name VARCHAR(255) NOT NULL,
	last_name VARCHAR(255) NOT NULL,
	email VARCHAR(255) NOT NULL UNIQUE,     -- Current email, can be changed
	email_verified BOOLEAN DEFAULT FALSE,
	email_verified_at TIMESTAMP WITH TIME ZONE,
	phone_number VARCHAR(50),               -- Optional, E.164 format
	avatar_url TEXT,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User passwords (for username/password auth)
CREATE TABLE user_passwords (
	user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	password_hash VARCHAR(255) NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Email verification tokens
CREATE TABLE email_verification_tokens (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	email VARCHAR(255) NOT NULL,  -- Email being verified (may differ from current)
	token_hash VARCHAR(255) NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Password reset tokens
CREATE TABLE password_reset_tokens (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	token_hash VARCHAR(255) NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- GitHub connections (for repo access + optional login)
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
	device_name VARCHAR(255) NOT NULL,       -- User-provided name (e.g., "Work Laptop")
	access_token_hash VARCHAR(255) NOT NULL,
	refresh_token_hash VARCHAR(255),
	scopes TEXT[] NOT NULL,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
	last_used_at TIMESTAMP WITH TIME ZONE,   -- Updated on each MCP request
	UNIQUE(access_token_hash)
);

-- OAuth authorization codes (short-lived)
CREATE TABLE oauth_codes (
	code VARCHAR(255) PRIMARY KEY,
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	client_id VARCHAR(255) NOT NULL,
	device_name VARCHAR(255) NOT NULL,       -- Captured during consent
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
  created_at: timestamp
  last_accessed: timestamp

TTL: 30 days (sliding expiration)
```

Sessions are auth-only. User details (username, first_name, last_name, avatar, etc.) are fetched via `/api/auth/me` or `/api/users/:id`.

---

## Authentication Flows

### 1. User Registration

**Invite Key Requirement**: Signup currently requires a valid invite key for early access control. See [Invite Keys Setup](#invite-keys-setup) for configuration.

```
Browser                        API                      PostgreSQL
   │                            │                            │
   │ POST /api/auth/signup      │                            │
   │ {username, email, password,│                            │
   │  first_name, last_name,    │                            │
   │  invite_key}               │                            │
   │───────────────────────────►│                            │
   │                            │                            │
   │                            │ Check username not taken   │
   │                            │ Check email not taken      │
   │                            │───────────────────────────►│
   │                            │                            │
   │                            │ Hash password (bcrypt)     │
   │                            │ Create user                │
   │                            │───────────────────────────►│
   │                            │                            │
   │                            │ Generate verification token│
   │                            │ Send email via SES         │
   │                            │                            │
   │◄───────────────────────────│                            │
   │ {message: "Check email"}   │                            │
   │                            │                            │
   │ User clicks email link     │                            │
   │                            │                            │
   │ GET /api/auth/verify?t=xxx │                            │
   │───────────────────────────►│                            │
   │                            │ Verify token               │
   │                            │ Mark email_verified=true   │
   │                            │───────────────────────────►│
   │◄───────────────────────────│                            │
   │ Redirect to login          │                            │
```

### 2. User Login (Username or Email)

Users can log in with either their username or email address.

```
Browser                        API                    PostgreSQL    Redis
   │                            │                        │           │
   │ POST /api/auth/login       │                        │           │
   │ {identifier, password}     │  (username or email)   │           │
   │───────────────────────────►│                        │           │
   │                            │                        │           │
   │                            │ Get user by username   │           │
   │                            │ OR by email            │           │
   │                            │───────────────────────►│           │
   │                            │◄───────────────────────│           │
   │                            │ {user, password_hash}  │           │
   │                            │                        │           │
   │                            │ bcrypt.compare()       │           │
   │                            │                        │           │
   │                            │ Create session         │           │
   │                            │──────────────────────────────────►│
   │                            │                        │           │
   │◄───────────────────────────│                        │           │
   │ Set-Cookie: session_id     │                        │           │
   │ {user}                     │                        │           │
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
   │                            │ {user_id, email, ...} │
   │                            │                       │
   │                            │ (valid session)       │
   │◄───────────────────────────│                       │
   │ Response                   │                       │
```

### 4. Password Reset

```
Browser                        API                    PostgreSQL
   │                            │                        │
   │ POST /api/auth/forgot      │                        │
   │ {email}                    │                        │
   │───────────────────────────►│                        │
   │                            │ Find user by email     │
   │                            │───────────────────────►│
   │                            │                        │
   │                            │ Generate reset token   │
   │                            │ Store hashed token     │
   │                            │───────────────────────►│
   │                            │                        │
   │                            │ Send email via SES     │
   │◄───────────────────────────│                        │
   │ {message: "Check email"}   │                        │
   │                            │                        │
   │ User clicks reset link     │                        │
   │                            │                        │
   │ POST /api/auth/reset       │                        │
   │ {token, new_password}      │                        │
   │───────────────────────────►│                        │
   │                            │ Verify token           │
   │                            │ Hash new password      │
   │                            │ Update user            │
   │                            │───────────────────────►│
   │◄───────────────────────────│                        │
   │ Redirect to login          │                        │
```

### 5. Logout

```
Browser                        API                         Redis
   │                            │                            │
   │ POST /api/auth/logout      │                            │
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

### OAuth Flow (Connect GitHub to existing account)

```
Browser                        API                         GitHub
   │                            │                            │
   │ GET /api/auth/github       │                            │
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
   │ GET /api/auth/github/cb    │                            │
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

### Login with GitHub (Future)

When GitHub login is enabled, the OAuth flow will:
1. Check if `github_user_id` exists in `github_connections`
2. If yes: log in that user (create session)
3. If no: create new user account, then create connection

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
```json
{
  "issuer": "https://api.specboard.io",
  "authorization_endpoint": "https://api.specboard.io/oauth/authorize",
  "token_endpoint": "https://api.specboard.io/oauth/token",
  "revocation_endpoint": "https://api.specboard.io/oauth/revoke",
  "scopes_supported": ["docs:read", "docs:write", "tasks:read", "tasks:write"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"]
}
```

### Authorization Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              USER'S MACHINE                                   │
│                                                                               │
│  ┌──────────────┐                                ┌─────────────────────────┐ │
│  │ Claude Code  │                                │       Browser           │ │
│  └──────┬───────┘                                └───────────┬─────────────┘ │
└─────────┼────────────────────────────────────────────────────┼───────────────┘
          │                                                    │
          │ 1. Generate PKCE:                                  │
          │    code_verifier = random(43-128 chars)            │
          │    code_challenge = BASE64URL(SHA256(code_verifier))
          │                                                    │
          │ 2. Open browser ──────────────────────────────────►│
          │                                                    │
          │                    GET /oauth/authorize            │
          │                    ?client_id=claude-code          │
          │                    &redirect_uri=http://127.0.0.1:PORT/callback
          │                    &response_type=code             │
          │                    &scope=tasks:read+tasks:write   │
          │                    &state=random                   │
          │                    &code_challenge=abc123          │
          │                    &code_challenge_method=S256     │
          │                                                    ▼
          │                              ┌─────────────────────────────────────┐
          │                              │        YOUR API                     │
          │                              │                                     │
          │                              │  3. Check session cookie            │
          │                              │     - If no session → redirect to   │
          │                              │       /login?next=/oauth/authorize  │
          │                              │     - If session → show consent     │
          │                              └──────────────┬──────────────────────┘
          │                                             │
          │                                             ▼
          │                              ┌─────────────────────────────────────┐
          │                              │      CONSENT SCREEN                 │
          │                              │                                     │
          │                              │  ┌─────────────────────────────┐   │
          │                              │  │ Claude Code wants access to │   │
          │                              │  │ your Specboard account   │   │
          │                              │  └─────────────────────────────┘   │
          │                              │                                     │
          │                              │  Device name:                       │
          │                              │  ┌─────────────────────────────┐   │
          │                              │  │ Work MacBook Pro            │   │
          │                              │  └─────────────────────────────┘   │
          │                              │  (Name this device for easy ID)    │
          │                              │                                     │
          │                              │  This will allow Claude Code to:   │
          │                              │  ☑ Read your tasks and epics       │
          │                              │  ☑ Create and update tasks         │
          │                              │                                     │
          │                              │  ┌─────────┐  ┌─────────┐          │
          │                              │  │  Deny   │  │ Approve │          │
          │                              │  └─────────┘  └─────────┘          │
          │                              └──────────────┬──────────────────────┘
          │                                             │
          │                                             │ 4. User enters device name
          │                                             │    and clicks Approve
          │                                             │
          │                                             │ 5. Generate auth code
          │                                             │    Store in oauth_codes:
          │                                             │    - code, user_id
          │                                             │    - device_name
          │                                             │    - code_challenge
          │                                             │    - scopes, redirect_uri
          │                                             │    - expires_at (10 min)
          │                                             │
          │   ◄─────────────────────────────────────────┘
          │   6. Redirect to:
          │      http://127.0.0.1:PORT/callback?code=AUTH_CODE&state=xyz
          │
          │ 7. Claude Code receives callback
          │
          │ 8. POST /oauth/token ─────────────────────────────────────────────┐
          │    Content-Type: application/x-www-form-urlencoded                │
          │    grant_type=authorization_code                                  │
          │    &code=AUTH_CODE                                                │
          │    &code_verifier=original_random_string                          │
          │    &redirect_uri=http://127.0.0.1:PORT/callback                   │
          │                                                                   ▼
          │                              ┌─────────────────────────────────────┐
          │                              │  YOUR API - /oauth/token            │
          │                              │                                     │
          │                              │  9. Validate:                       │
          │                              │     - code exists & not expired     │
          │                              │     - SHA256(code_verifier) ==      │
          │                              │       stored code_challenge         │
          │                              │     - redirect_uri matches          │
          │                              │                                     │
          │                              │  10. Create mcp_tokens row:         │
          │                              │      - device_name from oauth_codes │
          │                              │      - hash access & refresh tokens │
          │                              │      - scopes from oauth_codes      │
          │                              │                                     │
          │                              │  11. Delete oauth_codes row         │
          │                              │                                     │
          │                              │  12. Return tokens:                 │
          │                              │      {                              │
          │                              │        access_token: "...",         │
          │                              │        refresh_token: "...",        │
          │                              │        token_type: "Bearer",        │
          │                              │        expires_in: 3600             │
          │                              │      }                              │
          │                              └──────────────┬──────────────────────┘
          │                                             │
          │   ◄─────────────────────────────────────────┘
          │
          │ 13. Claude Code stores tokens (system keychain)
          │
          │ 14. All MCP requests include:
          │     Authorization: Bearer <access_token>
          │
          │ 15. MCP server updates last_used_at on each request
          │
└─────────┴────────────────────────────────────────────────────────────────────┘
```

### MCP Token Scopes

| Scope | Description | Allows |
|-------|-------------|--------|
| `docs:read` | Read documents | get_document, search_docs, list_documents |
| `docs:write` | Modify documents | create_document, update_document |
| `tasks:read` | Read tasks | get_task, get_epic, get_backlog |
| `tasks:write` | Modify tasks | create_task, update_task |

### Token Refresh Flow

When the access token expires, Claude Code uses the refresh token:

```
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=REFRESH_TOKEN
```

Response:
```json
{
  "access_token": "new_access_token",
  "refresh_token": "new_refresh_token",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

### MCP Request Validation

On each MCP request:

1. Extract `Authorization: Bearer <token>` header
2. Hash the token: `SHA256(token)`
3. Look up `mcp_tokens` by `access_token_hash`
4. Check `expires_at > NOW()`
5. Check requested scope is in `scopes` array
6. Update `last_used_at = NOW()`
7. Allow request

---

## Authorized Apps Management

Users can view and revoke MCP authorizations in Settings.

### UI

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Settings > Authorized Apps                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  These applications have access to your account.                             │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  🤖 Claude Code                                                        │ │
│  │     Work MacBook Pro                                                   │ │
│  │                                                                        │ │
│  │  Permissions: tasks:read, tasks:write                                  │ │
│  │  Authorized: Dec 15, 2025 at 2:30 PM                                   │ │
│  │  Last used: 2 hours ago                                                │ │
│  │                                                                        │ │
│  │                                              [Revoke Access]           │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  🤖 Claude Code                                                        │ │
│  │     Home Desktop                                                       │ │
│  │                                                                        │ │
│  │  Permissions: tasks:read, tasks:write, docs:read                       │ │
│  │  Authorized: Dec 20, 2025 at 10:15 AM                                  │ │
│  │  Last used: 5 days ago                                                 │ │
│  │                                                                        │ │
│  │                                              [Revoke Access]           │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/oauth/authorizations | Session | List user's authorized apps |
| DELETE | /api/oauth/authorizations/:id | Session | Revoke authorization |

#### GET /api/oauth/authorizations

Response:
```json
{
  "authorizations": [
    {
      "id": "uuid",
      "client_id": "claude-code",
      "device_name": "Work MacBook Pro",
      "scopes": ["tasks:read", "tasks:write"],
      "created_at": "2025-12-15T14:30:00Z",
      "last_used_at": "2025-12-29T10:00:00Z"
    }
  ]
}
```

#### DELETE /api/oauth/authorizations/:id

Deletes the `mcp_tokens` row. Next MCP request with that token returns 401.

Response: `204 No Content`

---

## Shared Auth Package

Both containers use `@specboard/auth` for session validation:

```
shared/auth/
├── src/
│   ├── index.ts           # Main exports
│   ├── session.ts         # Redis session management
│   ├── middleware.ts      # Hono auth middleware
│   ├── password.ts        # bcrypt hashing utilities
│   └── types.ts           # Session types
├── package.json
└── tsconfig.json
```

### Session Middleware

```typescript
// Used by both frontend and API containers
import { authMiddleware } from '@specboard/auth';

app.use('*', authMiddleware({
  redis: redisClient,
  excludePaths: ['/api/auth/*', '/health', '/login'],
  onUnauthenticated: (c) => c.redirect('/login'),
}));
```

---

## Token Lifetimes

| Token | Lifetime | Refresh |
|-------|----------|---------|
| Session | 30 days | Sliding window on access |
| Email verification | 24 hours | Request new |
| Password reset | 1 hour | Request new |
| MCP Access Token | 1 hour | Via refresh token |
| MCP Refresh Token | 30 days | Re-authorize |
| GitHub Access Token | No expiry* | N/A |

*GitHub tokens don't expire but can be revoked by user.

---

## Security Considerations

### Password Requirements

| Requirement | Value |
|-------------|-------|
| Minimum length | 12 characters |
| Maximum length | 512 characters |
| Uppercase | At least 1 |
| Lowercase | At least 1 |
| Digit | At least 1 |
| Special character | At least 1 |
| Common password check | Block passwords in common list |

**Implementation:**
- bcrypt with cost factor 12
- Check against bundled common password list (top 10k from SecLists)
- Passwords never logged or stored in plaintext

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
| /api/auth/login | 5 failed attempts per 15 minutes per identifier+IP; 100 total requests per 15 minutes per IP |
| /api/auth/signup | 3 per hour per IP |
| /api/auth/forgot | 3 per hour per email |
| General API | 100 requests per minute |

Limits are identical in every environment, deliberately: staging parity is
what surfaced the original successful-logins-counted lockout bug. Do not
loosen staging.

Testing notes:
- Successful logins are never counted; cycling through accounts at any pace
  is safe.
- Tests that deliberately submit wrong passwords >5 times must use a
  distinct identifier per case or flush Redis in setup.
- An automated suite doing >100 login requests per 15 min from one IP will
  trip the coarse cap. If that happens, add an env-var override for the
  numbers; no staging fork, no bypass headers.
- If separate clients seem to share one limit bucket, the proxy isn't
  setting X-Forwarded-For (getClientIp falls back to a shared "unknown").

---

## Infrastructure

### Components

| Resource | Purpose |
|----------|---------|
| ECS Fargate (Frontend) | Hono server for static files |
| ECS Fargate (API) | Hono server for API |
| ElastiCache Redis | Session storage |
| RDS PostgreSQL | User data, connections |
| KMS Key | GitHub token encryption |
| SES | Email sending (verification, password reset) |
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

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/signup | None | Create account |
| POST | /api/auth/login | None | Login, create session |
| POST | /api/auth/logout | Session | Logout, destroy session |
| GET | /api/auth/me | Session | Get current user |
| POST | /api/auth/forgot | None | Request password reset |
| POST | /api/auth/reset | None | Reset password with token |
| GET | /api/auth/verify | None | Verify email |
| GET | /api/auth/github | Session | Start GitHub OAuth |
| GET | /api/auth/github/cb | Session | GitHub OAuth callback |
| DELETE | /api/auth/github | Session | Disconnect GitHub |
| GET | /oauth/authorize | Session | MCP OAuth authorize (shows consent) |
| POST | /oauth/authorize | Session | MCP OAuth consent form submit |
| POST | /oauth/token | None | MCP token exchange |
| POST | /oauth/revoke | None | Revoke MCP token |
| GET | /api/oauth/authorizations | Session | List user's authorized apps |
| DELETE | /api/oauth/authorizations/:id | Session | Revoke specific authorization |
| GET | /.well-known/oauth-authorization-server | None | OAuth metadata |
| GET | /* | Session | Serve static files |

---

## Invite Keys Setup

Signup is gated behind invite keys for early access control. Valid keys are stored in AWS Secrets Manager.

### Configuring Invite Keys

1. **Via AWS Console:**
   - Go to AWS Secrets Manager
   - Find `specboard/invite-keys`
   - Click "Retrieve secret value" → "Edit"
   - Enter comma-separated keys: `key-one,key-two,another-key`
   - Save

2. **Via AWS CLI:**
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id specboard/invite-keys \
     --secret-string "key-one,key-two,another-key"
   ```

### How It Works

- Keys are loaded from `INVITE_KEYS` environment variable (injected from Secrets Manager)
- API validates the `invite_key` field on signup requests
- Invalid or missing keys return `403 Forbidden`
- If no keys are configured, all signups are rejected
- Keys are reusable (not consumed on use)

### Adding/Removing Keys

Update the secret value in Secrets Manager. Changes take effect on the next ECS service deployment (services read secrets at container startup).

To force an immediate update, redeploy the API service:
```bash
aws ecs update-service --cluster specboard --service api --force-new-deployment
```

---

## File Structure

```
shared/auth/
├── src/
│   ├── index.ts           # Main exports
│   ├── session.ts         # Redis session CRUD
│   ├── middleware.ts      # Hono auth middleware
│   ├── password.ts        # bcrypt utilities
│   └── types.ts           # Session/user types

api/src/
├── handlers/
│   ├── auth.ts            # Auth endpoints (login, signup, etc.)
│   ├── github.ts          # GitHub OAuth
│   └── oauth.ts           # MCP OAuth (authorize, token, revoke)
├── middleware/
│   ├── csrf.ts            # CSRF protection
│   └── rate-limit.ts      # Rate limiting
└── utils/
    └── encryption.ts      # KMS encryption

frontend/src/
├── index.ts               # Hono server entry
└── pages/
    ├── login.ts           # Server-rendered login page
    └── oauth-consent.ts   # OAuth consent screen
```
