# COMPLETE - 2026-01-09

# Google Gemini API Integration Plan

Add Google Gemini as a second AI provider alongside Anthropic, with a clean provider abstraction layer and model selection in the chat UI.

## Research Summary

**Google Gemini API:**
- Uses simple API keys (like Anthropic) - NO OAuth required
- Free tier: No credit card, 5-15 RPM, 250K TPM, 1000 RPD
- Get key from: https://aistudio.google.com/app/apikey
- Streaming endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse`
- Auth header: `x-goog-api-key`
- Key format: Typically starts with `AIza...`

## Architecture: Provider Abstraction

Create a `providers/` folder with a clean interface that each provider implements:

```
api/src/
├── handlers/
│   ├── chat.ts              # Uses provider abstraction
│   └── api-keys.ts          # Uses provider abstraction
└── providers/
    ├── index.ts             # Exports provider registry & interface
    ├── types.ts             # Provider interface definition
    ├── anthropic.ts         # Anthropic implementation
    └── gemini.ts            # Gemini implementation
```

### Provider Interface (`providers/types.ts`)

```typescript
import type { SSEStreamingApi } from 'hono/streaming';

export type ProviderName = 'anthropic' | 'gemini';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ModelInfo {
  id: string;                 // e.g., 'claude-sonnet-4-20250514'
  name: string;               // e.g., 'Claude Sonnet 4'
  description: string;        // e.g., 'Best for complex tasks'
  maxTokens: number;          // Max output tokens
  contextWindow?: number;     // Context window size
}

export interface ProviderConfig {
  name: ProviderName;
  displayName: string;        // e.g., 'Anthropic'
  description: string;        // e.g., 'Claude AI models'
  keyPrefix: string;          // e.g., 'sk-ant-' or 'AIza'
  keyPlaceholder: string;     // e.g., 'sk-ant-...'
  consoleUrl: string;         // URL to get API key
  models: ModelInfo[];        // Available models for this provider
  defaultModel: string;       // Default model ID
}

export interface ChatProvider {
  readonly config: ProviderConfig;

  // Validate key format (basic client-side validation)
  validateKeyFormat(key: string): boolean;

  // Test key against provider API
  validateKey(key: string): Promise<boolean>;

  // Stream chat response (model is now a parameter)
  streamChat(
    stream: SSEStreamingApi,
    apiKey: string,
    modelId: string,
    systemPrompt: string,
    messages: ChatMessage[]
  ): Promise<void>;
}
```

### Provider Registry (`providers/index.ts`)

```typescript
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import type { ChatProvider, ProviderName } from './types';

export const providers: Record<ProviderName, ChatProvider> = {
  anthropic: new AnthropicProvider(),
  gemini: new GeminiProvider(),
};

export function getProvider(name: ProviderName): ChatProvider {
  return providers[name];
}

export function isValidProvider(name: string): name is ProviderName {
  return name in providers;
}

export const PROVIDER_NAMES: ProviderName[] = ['anthropic', 'gemini'];
```

## Files to Create

### 1. `api/src/providers/types.ts`
- Define `ProviderName`, `ChatMessage`, `ProviderConfig`, `ChatProvider` interfaces

### 2. `api/src/providers/anthropic.ts`
- Move Anthropic-specific logic from `chat.ts`
- Implement `ChatProvider` interface
- Include key validation and streaming

### 3. `api/src/providers/gemini.ts`
- Implement `ChatProvider` interface for Gemini
- REST-based streaming (no SDK needed)
- Key validation via test API call

### 4. `api/src/providers/index.ts`
- Export provider registry
- Export helper functions

## Files to Modify

### 5. `shared/db/src/types.ts`
- Update `ApiKeyProvider` type: `'anthropic' | 'gemini'`

### 6. `api/src/handlers/api-keys.ts`
- Import from `providers/` instead of hardcoded logic
- Use `provider.validateKeyFormat()` and `provider.validateKey()`
- Remove `VALID_PROVIDERS` constant (use registry)
- Remove `validateAnthropicKey()` function

### 7. `api/src/handlers/chat.ts`
- Accept `provider` parameter in request body
- Use provider registry to get correct implementation
- Remove Anthropic-specific code (moved to provider)
- Simplified: just routes to `provider.streamChat()`

### 8. `web/src/routes/settings/ApiKeys.tsx`
- Fetch provider configs from backend or embed them
- Add provider dropdown in "Add Key" dialog
- Add "Test" button for each existing key
- Support multiple providers in the list

### 9. `web/src/routes/settings/ApiKeys.module.css`
- Styles for provider selector and test button

### 10. `shared/pages/ChatSidebar/ChatSidebar.tsx`
- Add model selector dropdown in header (shows all models from all configured providers)
- Pass `provider` and `model` in API request
- Store selection in localStorage
- Group models by provider in dropdown (optgroup)
- Only show models for providers with configured API keys

### 11. `shared/pages/ChatSidebar/ChatSidebar.module.css`
- Styles for model selector

### 12. New API endpoint: `GET /api/chat/models`
- Returns available models based on user's configured API keys
- Used by frontend to populate model selector

## Task Breakdown

1. **Create provider abstraction layer**
   - `api/src/providers/types.ts` - interfaces (Provider, Model, ChatMessage)
   - `api/src/providers/index.ts` - registry and helpers
   - `api/src/providers/anthropic.ts` - refactor existing code, define models
   - `api/src/providers/gemini.ts` - new implementation with models

2. **Update database types**
   - `shared/db/src/types.ts` - add `'gemini'` to `ApiKeyProvider` union

3. **Refactor backend handlers**
   - `api/src/handlers/api-keys.ts` - use provider abstraction
   - `api/src/handlers/chat.ts` - accept provider + model, use abstraction
   - New: `api/src/handlers/chat-models.ts` - GET /api/chat/models endpoint

4. **Update frontend settings**
   - `web/src/routes/settings/ApiKeys.tsx` - multi-provider + test button

5. **Update chat sidebar**
   - `shared/pages/ChatSidebar/ChatSidebar.tsx` - model selector dropdown
   - Fetch available models on mount
   - Persist selected model to localStorage

## Provider Implementation Details

### Anthropic Provider

```typescript
export class AnthropicProvider implements ChatProvider {
  readonly config: ProviderConfig = {
    name: 'anthropic',
    displayName: 'Anthropic',
    description: 'Claude AI models',
    keyPrefix: 'sk-ant-',
    keyPlaceholder: 'sk-ant-...',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        description: 'Best balance of intelligence and speed',
        maxTokens: 8192,
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        description: 'Fast and affordable',
        maxTokens: 8192,
      },
    ],
    defaultModel: 'claude-sonnet-4-20250514',
  };

  validateKeyFormat(key: string): boolean {
    return key.startsWith('sk-ant-');
  }

  async validateKey(key: string): Promise<boolean> {
    // Existing validation logic using claude-3-haiku
  }

  async streamChat(stream, apiKey, modelId, systemPrompt, messages): Promise<void> {
    // Existing streaming logic using @anthropic-ai/sdk
    // Now uses modelId parameter instead of hardcoded model
  }
}
```

### Gemini Provider

```typescript
export class GeminiProvider implements ChatProvider {
  readonly config: ProviderConfig = {
    name: 'gemini',
    displayName: 'Google Gemini',
    description: 'Gemini AI models (free tier available)',
    keyPrefix: 'AIza',
    keyPlaceholder: 'AIza...',
    consoleUrl: 'https://aistudio.google.com/app/apikey',
    models: [
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        description: 'Latest, fast and capable',
        maxTokens: 8192,
      },
      {
        id: 'gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        description: 'Previous generation, very stable',
        maxTokens: 8192,
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        description: 'Most capable Gemini model',
        maxTokens: 8192,
      },
    ],
    defaultModel: 'gemini-2.0-flash',
  };

  validateKeyFormat(key: string): boolean {
    return key.startsWith('AIza');
  }

  async validateKey(key: string): Promise<boolean> {
    // Test with minimal generateContent call
  }

  async streamChat(stream, apiKey, modelId, systemPrompt, messages): Promise<void> {
    // Gemini streaming via REST API
    // POST to /v1beta/models/{modelId}:streamGenerateContent?alt=sse
  }
}
```

### Chat Sidebar Model Selector UI

```tsx
// Model selector in header, grouped by provider
<select value={selectedModel} onChange={handleModelChange}>
  <optgroup label="Anthropic">
    <option value="anthropic:claude-sonnet-4-20250514">Claude Sonnet 4</option>
    <option value="anthropic:claude-3-5-haiku-20241022">Claude 3.5 Haiku</option>
  </optgroup>
  <optgroup label="Google Gemini">
    <option value="gemini:gemini-2.0-flash">Gemini 2.0 Flash</option>
    <option value="gemini:gemini-1.5-flash">Gemini 1.5 Flash</option>
  </optgroup>
</select>

// Value format: "provider:model" for easy parsing
```

## Verification

1. **Provider Abstraction:**
   - Both providers implement the same interface
   - Easy to add new providers in the future
   - Model list is part of provider config

2. **Settings Page:**
   - Can add Anthropic and Gemini keys separately
   - "Test" button works for each provider
   - Shows appropriate console URL for each provider

3. **Chat Sidebar:**
   - Model selector dropdown visible in header
   - Shows models grouped by provider (optgroup)
   - Only shows models for providers with configured keys
   - Selection persisted in localStorage across page loads
   - Disabled during streaming

4. **End-to-end testing:**
   - Select Claude Sonnet 4 → send message → streaming works
   - Select Gemini 2.0 Flash → send message → streaming works
   - Switch models mid-conversation → responses continue correctly
   - Select model for unconfigured provider → shows helpful error
