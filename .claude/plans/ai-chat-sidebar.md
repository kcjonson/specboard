# COMPLETE - 2026-01-08

# AI Chat Sidebar with Anthropic API Integration

## Overview

Add a chat sidebar to the document editor that uses the user's own Anthropic API key for AI-powered document assistance. Per-user API keys are stored encrypted in the database, with streaming SSE responses for real-time chat UX.

## User Flow

1. **Settings → API Keys**: User manually adds their Anthropic API key (from console.anthropic.com)
2. **App encrypts & stores**: Key encrypted with AES-256-GCM before database storage
3. **Editor → Chat**: User opens sidebar, asks questions with full document context
4. **Streaming responses**: Words appear in real-time as Claude generates them

---

## Implementation Steps

### Phase 1: Database & Encryption

#### 1.1 Create encryption utilities
**File:** `shared/auth/src/encryption.ts` (new)

```typescript
// AES-256-GCM encryption using Node.js crypto
// - encrypt(plaintext, key) → { ciphertext, iv, authTag }
// - decrypt(encrypted, key) → plaintext
// - getEncryptionKey() → reads from API_KEY_ENCRYPTION_KEY env var
```

Export from `shared/auth/src/index.ts`

#### 1.2 Database migration
**File:** `shared/db/migrations/009_ai_api_keys.sql` (new)

```sql
CREATE TABLE user_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,  -- 'anthropic'
    key_name VARCHAR(255) NOT NULL,
    encrypted_key TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, provider)
);
```

#### 1.3 Add types
**File:** `shared/db/src/types.ts`
- Add `UserApiKey` interface

---

### Phase 2: Backend API

#### 2.1 API key handler
**File:** `api/src/handlers/api-keys.ts` (new)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/users/me/api-keys` | GET | List configured keys (masked) |
| `/api/users/me/api-keys` | POST | Add new key (encrypt before storage) |
| `/api/users/me/api-keys/:provider` | DELETE | Remove key |
| `/api/users/me/api-keys/:provider/validate` | POST | Test key works |

Response format for list:
```json
[{ "provider": "anthropic", "key_name": "My Key", "masked_key": "sk-ant-...x5Kg", "last_used_at": null }]
```

#### 2.2 Chat handler with SSE streaming
**File:** `api/src/handlers/chat.ts` (new)

Endpoint: `POST /api/projects/:projectId/chat`

Request:
```json
{
  "message": "How can I improve this intro?",
  "document_content": "# My Doc\n...",
  "conversation_history": [{ "role": "user", "content": "..." }]
}
```

Response: SSE stream
```
event: delta
data: {"text": "The"}

event: delta
data: {"text": " document"}

event: done
data: {"usage": {"input_tokens": 150, "output_tokens": 89}}
```

Implementation:
- Use `streamSSE` from `hono/streaming`
- Decrypt user's API key from database
- Call Anthropic SDK with `stream: true`
- Forward text deltas as SSE events

#### 2.3 Register routes
**File:** `api/src/index.ts`

Add imports and routes:
```typescript
// API key management
app.get('/api/users/me/api-keys', handleListApiKeys);
app.post('/api/users/me/api-keys', handleCreateApiKey);
app.delete('/api/users/me/api-keys/:provider', handleDeleteApiKey);
app.post('/api/users/me/api-keys/:provider/validate', handleValidateApiKey);

// Chat
app.post('/api/projects/:projectId/chat', handleChat);
```

#### 2.4 Install Anthropic SDK
```bash
pnpm --filter @doc-platform/api add @anthropic-ai/sdk
```

---

### Phase 3: Settings UI

#### 3.1 ApiKeys component
**File:** `web/src/routes/settings/ApiKeys.tsx` (new)

Features:
- List configured API keys (provider, masked key, last used)
- "Add API Key" button → opens dialog
- Dialog: provider dropdown, key name input, API key input (password field)
- Optional "Validate" button before save
- Delete key with confirmation

Following pattern from `AuthorizedApps.tsx`

#### 3.2 ApiKeys styles
**File:** `web/src/routes/settings/ApiKeys.module.css` (new)

#### 3.3 Integrate into UserSettings
**File:** `web/src/routes/settings/UserSettings.tsx`

Add after `<AuthorizedApps />` (around line 409):
```tsx
{!isViewingOther && (
    <ApiKeys />
)}
```

---

### Phase 4: Chat Sidebar

#### 4.1 ChatSidebar component
**File:** `shared/pages/ChatSidebar/ChatSidebar.tsx` (new)

Props:
```typescript
interface ChatSidebarProps {
    projectId: string;
    documentContent?: string;
    documentPath?: string;
    onClose: () => void;
}
```

Features:
- Message list (user/assistant bubbles)
- Input field with send button
- Streaming response display (words appear as received)
- "No API key" state with link to settings
- Conversation history (in-memory, clears on close)

SSE reading pattern:
```typescript
const response = await fetch(`/api/projects/${projectId}/chat`, { ... });
const reader = response.body?.getReader();
// Parse SSE chunks, update message content progressively
```

#### 4.2 ChatSidebar styles
**File:** `shared/pages/ChatSidebar/ChatSidebar.module.css` (new)

- Fixed width (360px) right sidebar
- Message list scrollable
- Input area fixed at bottom

#### 4.3 ChatMessage component
**File:** `shared/pages/ChatSidebar/ChatMessage.tsx` (new)

- Render user (right-aligned) vs assistant (left-aligned) messages
- Streaming indicator (pulsing cursor)
- Basic markdown rendering for assistant responses

#### 4.4 Integrate into Editor
**File:** `shared/pages/Editor/Editor.tsx`

Add state and sidebar:
```tsx
const [showChat, setShowChat] = useState(false);

// In return, wrap main content:
<div class={styles.mainArea}>
    <main class={styles.main}>
        {/* existing content */}
    </main>
    {showChat && (
        <ChatSidebar
            projectId={projectId}
            documentContent={toMarkdown(documentModel.content, documentModel.comments)}
            documentPath={documentModel.filePath}
            onClose={() => setShowChat(false)}
        />
    )}
</div>
```

#### 4.5 Add chat toggle to EditorHeader
**File:** `shared/pages/Editor/EditorHeader.tsx`

Add "Ask AI" button that calls `onToggleChat` prop

#### 4.6 Update Editor styles
**File:** `shared/pages/Editor/Editor.module.css`

Add layout for chat sidebar alongside main content

---

### Phase 5: Environment & Deployment

#### 5.1 Add encryption key to environment
- Development: Add `API_KEY_ENCRYPTION_KEY` to `.env`
  - Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Production: Add to AWS Secrets Manager, inject via ECS task definition

#### 5.2 Update CDK (if needed)
**File:** `infra/lib/doc-platform-stack.ts`
- Add secret for `API_KEY_ENCRYPTION_KEY`
- Pass to API service environment

---

## Files Summary

### New Files
| File | Description |
|------|-------------|
| `shared/auth/src/encryption.ts` | AES-256-GCM encryption utilities |
| `shared/db/migrations/009_ai_api_keys.sql` | Database schema |
| `api/src/handlers/api-keys.ts` | API key CRUD endpoints |
| `api/src/handlers/chat.ts` | SSE streaming chat endpoint |
| `web/src/routes/settings/ApiKeys.tsx` | Settings UI for API keys |
| `web/src/routes/settings/ApiKeys.module.css` | Styles |
| `shared/pages/ChatSidebar/ChatSidebar.tsx` | Chat sidebar component |
| `shared/pages/ChatSidebar/ChatSidebar.module.css` | Styles |
| `shared/pages/ChatSidebar/ChatMessage.tsx` | Message rendering |

### Modified Files
| File | Changes |
|------|---------|
| `shared/auth/src/index.ts` | Export encryption utilities |
| `shared/db/src/types.ts` | Add `UserApiKey` type |
| `api/src/index.ts` | Register new routes |
| `web/src/routes/settings/UserSettings.tsx` | Add `<ApiKeys />` |
| `shared/pages/Editor/Editor.tsx` | Add chat sidebar integration |
| `shared/pages/Editor/EditorHeader.tsx` | Add "Ask AI" button |
| `shared/pages/Editor/Editor.module.css` | Layout for sidebar |

---

## Security Considerations

1. **Encryption**: AES-256-GCM with random 12-byte IV per encryption
2. **Key never returned**: After storage, only masked version shown (`sk-ant-...x5Kg`)
3. **Encryption key**: Stored in environment variable (Secrets Manager for prod)
4. **CSRF protection**: Existing middleware protects all POST/DELETE endpoints
5. **Session validation**: All endpoints require authenticated session
6. **No logging**: Never log decrypted API keys
