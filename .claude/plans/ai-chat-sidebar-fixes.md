# COMPLETE - 2026-01-09

# AI Chat Sidebar - Review Fixes Plan

## Overview

Fix all issues identified by 5 code review agents (2 security, 1 performance, 1 code quality, 1 UX/accessibility).

---

## Phase 1: Critical Security & Stability Fixes

### 1.1 Add Input Validation with Size Limits
**File:** `api/src/handlers/chat.ts`
**Issues:** Security (DoS/cost attack), Performance, Stability

```typescript
// Add after line 94
const MAX_MESSAGE_LENGTH = 10000;
const MAX_DOCUMENT_LENGTH = 100000;
const MAX_HISTORY_LENGTH = 50;
const MAX_HISTORY_MESSAGE_LENGTH = 10000;

if (message.length > MAX_MESSAGE_LENGTH) {
  return context.json({ error: 'Message too long' }, 400);
}
if (document_content && document_content.length > MAX_DOCUMENT_LENGTH) {
  return context.json({ error: 'Document too large' }, 400);
}
if (conversation_history.length > MAX_HISTORY_LENGTH) {
  return context.json({ error: 'Conversation history too long' }, 400);
}
// Validate each history message
for (const msg of conversation_history) {
  if (!['user', 'assistant'].includes(msg.role)) {
    return context.json({ error: 'Invalid role in conversation history' }, 400);
  }
  if (typeof msg.content !== 'string' || msg.content.length > MAX_HISTORY_MESSAGE_LENGTH) {
    return context.json({ error: 'Invalid message in conversation history' }, 400);
  }
}
```

### 1.2 Remove Unused projectId or Add Validation
**File:** `api/src/handlers/chat.ts`
**Issue:** Security (IDOR risk)

Option A (Remove): Change route from `/api/projects/:projectId/chat` to `/api/chat`
Option B (Validate): Add project ownership check

**Decision:** Remove projectId - it's not used and adds false sense of project scoping.

**Files to update:**
- `api/src/index.ts` - Change route registration
- `shared/pages/ChatSidebar/ChatSidebar.tsx` - Update fetch URL

### 1.3 Add Chat-Specific Rate Limiting
**File:** `api/src/index.ts`
**Issue:** Security (cost attack on user's API key)

```typescript
// Add to rate limit rules
{ path: '/api/chat', config: { windowMs: 60000, max: 20 } }, // 20 req/min for chat
```

### 1.4 Sanitize Error Messages
**File:** `api/src/handlers/chat.ts`
**Issue:** Security (information disclosure)

```typescript
// Replace direct error message exposure
const safeErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    if (error.message.includes('401') || error.message.includes('invalid')) {
      return 'API key configuration error';
    }
    if (error.message.includes('rate') || error.message.includes('429')) {
      return 'Service temporarily unavailable';
    }
  }
  return 'An error occurred';
};
```

---

## Phase 2: Performance Fixes

### 2.1 Memoize ChatMessage Component
**File:** `shared/pages/ChatSidebar/ChatMessage.tsx`
**Issue:** Unnecessary re-renders during streaming

```typescript
import { memo } from 'preact/compat';

export const ChatMessage = memo(function ChatMessage({ ... }): JSX.Element {
  // existing implementation
});
```

### 2.2 Throttle State Updates During Streaming
**File:** `shared/pages/ChatSidebar/ChatSidebar.tsx`
**Issue:** 10-50 state updates per second during streaming

```typescript
// Use ref to accumulate content, flush to state every 50ms
const pendingContentRef = useRef('');
const flushTimeoutRef = useRef<number | null>(null);

// In streaming loop:
pendingContentRef.current += parsed.text;
if (!flushTimeoutRef.current) {
  flushTimeoutRef.current = window.setTimeout(() => {
    setMessages(prev => /* update with accumulated content */);
    pendingContentRef.current = '';
    flushTimeoutRef.current = null;
  }, 50);
}
```

### 2.3 Fix Auto-Scroll to Trigger on Message Count Only
**File:** `shared/pages/ChatSidebar/ChatSidebar.tsx`
**Issue:** scrollIntoView called on every token

```typescript
const messageCount = messages.length;
useEffect(() => {
  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
}, [messageCount]); // Only on new messages, not content changes
```

### 2.4 Store Masked Key at Creation (Avoid Decrypt for Display)
**File:** `api/src/handlers/api-keys.ts`
**Issue:** Decrypt API key just to mask it for listing

Add `masked_key` column to store pre-computed mask:
- Update migration `009_ai_api_keys.sql` to add column
- Store masked key at creation time
- Return stored mask instead of decrypting

### 2.5 Make last_used_at Update Async
**File:** `api/src/handlers/api-keys.ts`
**Issue:** Extra DB write on every chat request

```typescript
// Fire-and-forget, don't await
query('UPDATE user_api_keys SET last_used_at = NOW() WHERE user_id = $1 AND provider = $2', [userId, provider])
  .catch(err => console.error('Failed to update last_used_at:', err));
```

### 2.6 Cache Encryption Key Buffer
**File:** `shared/auth/src/encryption.ts`
**Issue:** Buffer.from called on every encrypt/decrypt

```typescript
let cachedKey: Buffer | null = null;

export function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  // ... validation
  cachedKey = Buffer.from(keyHex, 'hex');
  return cachedKey;
}
```

---

## Phase 3: Code Quality Fixes

### 3.1 Add Runtime Validation for Request Bodies
**Files:** `api/src/handlers/api-keys.ts`, `api/src/handlers/chat.ts`
**Issue:** TypeScript generics don't validate at runtime

```typescript
// After json parsing, validate structure
const body = await context.req.json();
if (!body || typeof body.message !== 'string') {
  return context.json({ error: 'Invalid request body' }, 400);
}
```

### 3.2 Add AbortController for Cleanup on Unmount
**File:** `shared/pages/ChatSidebar/ChatSidebar.tsx`
**Issue:** Stream continues if component unmounts

```typescript
const abortControllerRef = useRef<AbortController | null>(null);

// In handleSubmit:
abortControllerRef.current = new AbortController();
const response = await fetch(url, {
  signal: abortControllerRef.current.signal,
  ...
});

// Cleanup on unmount:
useEffect(() => {
  return () => abortControllerRef.current?.abort();
}, []);
```

### 3.3 Add Hex Validation to Encryption Key
**File:** `shared/auth/src/encryption.ts`
**Issue:** Invalid hex characters silently produce wrong key

```typescript
if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
  throw new Error('API_KEY_ENCRYPTION_KEY must be 64 valid hex characters');
}
```

### 3.4 Log Decryption Failures as Security Events
**File:** `api/src/handlers/api-keys.ts`
**Issue:** Silent catch hides security incidents

```typescript
} catch (error) {
  console.error('Decryption failed for user API key - possible tampering or key rotation:', {
    userId: row.user_id,
    provider: row.provider,
  });
  maskedKey = '****';
}
```

### 3.5 Extract Model Name to Constant
**File:** `api/src/handlers/chat.ts`
**Issue:** Hardcoded model name

```typescript
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
// Use in API call
model: CLAUDE_MODEL,
```

### 3.6 Handle Delete Failure in Validate Flow
**File:** `web/src/routes/settings/ApiKeys.tsx`
**Issue:** Race condition if delete fails after invalid validation

```typescript
if (!result.valid) {
  try {
    await fetchClient.delete('/api/users/me/api-keys/anthropic');
  } catch (deleteErr) {
    setAddError('Key is invalid but could not be removed. Please delete manually.');
    await loadKeys(); // Refresh to show current state
    return;
  }
}
```

---

## Phase 4: Accessibility Fixes

### 4.1 Add Focus Trap to Dialog
**File:** `web/src/routes/settings/ApiKeys.tsx`
**Issue:** Tab can escape modal dialog

```typescript
// Add focus trap hook or implement manually
useEffect(() => {
  if (!showAddDialog) return;

  const dialog = dialogRef.current;
  const focusableElements = dialog?.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const firstElement = focusableElements?.[0] as HTMLElement;
  const lastElement = focusableElements?.[focusableElements.length - 1] as HTMLElement;

  firstElement?.focus();

  const handleTab = (e: KeyboardEvent) => {
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    }
    if (e.key === 'Escape') {
      setShowAddDialog(false);
    }
  };

  document.addEventListener('keydown', handleTab);
  return () => document.removeEventListener('keydown', handleTab);
}, [showAddDialog]);
```

### 4.2 Add ARIA Attributes to Dialog
**File:** `web/src/routes/settings/ApiKeys.tsx`

```tsx
<div
  class={styles.dialog}
  role="dialog"
  aria-modal="true"
  aria-labelledby="add-api-key-title"
  ref={dialogRef}
>
  <h3 id="add-api-key-title">Add Anthropic API Key</h3>
```

### 4.3 Add ARIA Live Region for Streaming Messages
**File:** `shared/pages/ChatSidebar/ChatSidebar.tsx`

```tsx
<div
  class={styles.messages}
  role="log"
  aria-live="polite"
  aria-label="Chat messages"
>
```

### 4.4 Add aria-expanded to Ask AI Button
**File:** `shared/pages/Editor/EditorHeader.tsx`

```tsx
<Button
  onClick={onToggleChat}
  variant={showChat ? 'primary' : 'secondary'}
  aria-expanded={showChat}
  aria-controls="ai-chat-sidebar"
>
  Ask AI
</Button>
```

### 4.5 Add aria-label to Send Button
**File:** `shared/pages/ChatSidebar/ChatSidebar.tsx`

```tsx
<Button
  onClick={handleSubmit}
  disabled={!input.trim() || isStreaming}
  aria-label={isStreaming ? 'Sending message' : 'Send message'}
>
```

### 4.6 Add Role to Error Messages
**Files:** `ChatSidebar.tsx`, `ApiKeys.tsx`

```tsx
<div class={styles.error} role="alert">
```

### 4.7 Add Loading State Announcements
**File:** `web/src/routes/settings/ApiKeys.tsx`

```tsx
{loading && (
  <div class={styles.loading} role="status" aria-live="polite">
    Loading API keys...
  </div>
)}
```

### 4.8 Add Focus-Visible Styles
**Files:** `ChatSidebar.module.css`, `ApiKeys.module.css`

```css
.closeButton:focus-visible,
.suggestion:focus-visible,
.sendButton:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
```

### 4.9 Add prefers-reduced-motion
**File:** `shared/pages/ChatSidebar/ChatSidebar.module.css`

```css
@media (prefers-reduced-motion: reduce) {
  .cursor {
    animation: none;
  }
}
```

### 4.10 Add Semantic Role to Chat Messages
**File:** `shared/pages/ChatSidebar/ChatMessage.tsx`

```tsx
<div
  class={`${styles.message} ${styles[role]}`}
  role="article"
  aria-label={`${role === 'user' ? 'You' : 'AI assistant'} said`}
>
```

---

## Phase 5: Database Migration Update

### 5.1 Add masked_key Column
**File:** `shared/db/migrations/009_ai_api_keys.sql`

```sql
-- Add masked_key column for display without decryption
ALTER TABLE user_api_keys ADD COLUMN masked_key VARCHAR(20) NOT NULL DEFAULT '****';
```

Wait - this is a new migration, not altering. Update the CREATE TABLE to include:
```sql
masked_key VARCHAR(20) NOT NULL,
```

---

## Files Summary

### Files to Modify

| File | Changes |
|------|---------|
| `api/src/handlers/chat.ts` | Input validation, error sanitization, model constant, route change |
| `api/src/handlers/api-keys.ts` | Runtime validation, async last_used_at, log decryption failures, store masked_key |
| `api/src/index.ts` | Route change, rate limit rule |
| `shared/auth/src/encryption.ts` | Hex validation, key caching |
| `shared/pages/ChatSidebar/ChatSidebar.tsx` | AbortController, throttled updates, ARIA attrs, scroll fix |
| `shared/pages/ChatSidebar/ChatSidebar.module.css` | Focus styles, reduced-motion |
| `shared/pages/ChatSidebar/ChatMessage.tsx` | memo(), ARIA role |
| `shared/pages/Editor/EditorHeader.tsx` | aria-expanded |
| `web/src/routes/settings/ApiKeys.tsx` | Focus trap, ARIA, escape key, error handling |
| `web/src/routes/settings/ApiKeys.module.css` | Focus styles |
| `shared/db/migrations/009_ai_api_keys.sql` | Add masked_key column |
| `shared/db/src/types.ts` | Add masked_key to UserApiKey |

---

## Implementation Order

1. **Phase 1** - Security (most critical)
2. **Phase 5** - Database migration (needed for Phase 2.4)
3. **Phase 2** - Performance
4. **Phase 3** - Code quality
5. **Phase 4** - Accessibility

Total: ~35 individual fixes across 12 files.
