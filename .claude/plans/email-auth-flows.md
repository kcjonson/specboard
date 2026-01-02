# Email Verification & Password Reset Implementation

## Overview

Implement three authentication flows:
1. **Email verification** - Block users until they verify email after signup
2. **Password reset** - Forgot password flow with reset link (1 hour expiry)
3. **Change password** - In-app password change requiring current password

## Configuration

- Token expiry: 1 hour
- SES region: us-west-2
- Users blocked until `email_verified = true`

---

## Phase 1: Email Service Package

Create `/shared/email/` package:

```
shared/email/
├── package.json          # @doc-platform/email, depends on @aws-sdk/client-ses
├── tsconfig.json
└── src/
    ├── index.ts          # Re-exports
    ├── client.ts         # SES client, sendEmail(to, subject, body)
    └── templates.ts      # getVerificationEmail(url), getPasswordResetEmail(url)
```

**Environment variables needed:**
- `SES_REGION` = us-west-2
- `EMAIL_FROM` = noreply@specboard.io
- `APP_URL` = https://staging.specboard.io

---

## Phase 2: Token Utilities

Add `/shared/auth/src/tokens.ts`:
- `generateToken()` - crypto.randomBytes(32).toString('hex')
- `hashToken(token)` - SHA-256 hash
- `TOKEN_EXPIRY_MS` = 3600000 (1 hour)

Export from `/shared/auth/src/index.ts`

---

## Phase 3: API Endpoints

Modify `/api/src/handlers/auth.ts`:

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/auth/verify-email` | POST | None | Verify token, set email_verified=true |
| `/api/auth/resend-verification` | POST | None | Resend verification email |
| `/api/auth/forgot-password` | POST | None | Send password reset email |
| `/api/auth/reset-password` | POST | None | Reset password with token |
| `/api/auth/change-password` | PUT | Session | Change password (requires current) |

**Modify existing handlers:**

1. `handleSignup`:
   - Generate verification token
   - Store hash in `email_verification_tokens`
   - Send verification email
   - **Remove session creation** (don't log user in)
   - Return `{ message: "Check email" }`

2. `handleLogin`:
   - Check `email_verified` before allowing login
   - Return 403 with `{ error: "Verify email first", email_not_verified: true }`

**Register routes in `/api/src/index.ts`**

**Rate limiting:**
- `/api/auth/forgot-password`: 3/hour/IP
- `/api/auth/resend-verification`: 3/hour/IP

---

## Phase 4: SSG Pages

Create new pages in `/ssg/src/pages/`:

| Page | Route | Purpose |
|------|-------|---------|
| `verify-email.tsx` | `/verify-email` | "Check your email" + resend button |
| `verify-email-confirm.tsx` | `/verify-email/confirm?token=xxx` | Auto-submit token, redirect to login |
| `forgot-password.tsx` | `/forgot-password` | Enter email form |
| `reset-password.tsx` | `/reset-password?token=xxx` | New password form |

Create matching CSS in `/ssg/src/styles/`

Update `/ssg/src/build.ts` to include new pages

**Modify `/ssg/src/pages/signup.tsx`:**
- Redirect to `/verify-email?email={email}` on success (not `/`)

---

## Phase 5: Settings - Change Password

Create `/web/src/routes/settings/ChangePasswordDialog.tsx`:
- Modal dialog
- Fields: Current Password, New Password, Confirm New Password
- Validation (passwords match, requirements)
- Submit to `PUT /api/auth/change-password`

Create `/web/src/routes/settings/ChangePasswordDialog.module.css`

Modify `/web/src/routes/settings/UserSettings.tsx`:
- Add "Change Password" button
- Open/close dialog state

---

## Phase 6: Infrastructure (CDK)

Modify `/infra/lib/doc-platform-stack.ts`:

1. Add SES email identity for domain
2. Grant `ses:SendEmail` permission to API task role
3. Add environment variables: `SES_REGION`, `EMAIL_FROM`, `APP_URL`

---

## Phase 7: Frontend Routing

Ensure `/frontend/src/index.ts` serves new SSG pages (unauthenticated routes):
- `/verify-email`
- `/verify-email/confirm`
- `/forgot-password`
- `/reset-password`

---

## Critical Files

| File | Changes |
|------|---------|
| `/api/src/handlers/auth.ts` | 5 new handlers + modify signup/login |
| `/api/src/index.ts` | Register new routes |
| `/shared/auth/src/tokens.ts` | New file - token utilities |
| `/shared/email/` | New package - email service |
| `/ssg/src/pages/` | 4 new page components |
| `/ssg/src/build.ts` | Register new pages |
| `/web/src/routes/settings/UserSettings.tsx` | Add change password button |
| `/web/src/routes/settings/ChangePasswordDialog.tsx` | New component |
| `/infra/lib/doc-platform-stack.ts` | SES setup + env vars |

---

## Database Tables (Already Exist)

- `email_verification_tokens` (user_id, email, token_hash, expires_at)
- `password_reset_tokens` (user_id, token_hash, expires_at)
- `users.email_verified`, `users.email_verified_at`

---

## Security Notes

- Store token hashes (SHA-256), not raw tokens
- Use constant-time comparison for token verification
- Always return success for email-based ops (prevent enumeration)
- Password reset invalidates all existing sessions
- Rate limit forgot-password and resend-verification
