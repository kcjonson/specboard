# COMPLETE - 2026-01-09

# Provider Implementation Fixes

Fixes for issues identified in code review of multi-provider AI implementation.

## Issues to Fix

### High Priority

1. **Security: Remove raw error logging in Gemini** (`api/src/providers/gemini.ts:137`)
   - Remove `errorText` from console.error to prevent sensitive info leakage

2. **Architecture: Add timeout to streaming** (`api/src/handlers/chat.ts`)
   - Add 60-second timeout to prevent hung connections

3. **Settings: Fix race condition in validate flow** (`web/src/routes/settings/ApiKeys.tsx`)
   - Change to validate-first approach before inserting key

4. **Gemini: Add role to systemInstruction** (`api/src/providers/gemini.ts`)
   - Add `role: 'user'` to systemInstruction object per API spec

5. **Architecture: Extract shared error sanitization**
   - Create `api/src/providers/utils.ts` with shared `getSafeErrorMessage()`
   - Import in both anthropic.ts and gemini.ts

### Medium Priority

6. **Settings: Auto-dismiss test results** (`web/src/routes/settings/ApiKeys.tsx`)
   - Clear test result after 5 seconds

7. **Settings: Handle unmount during async** (`web/src/routes/settings/ApiKeys.tsx`)
   - Add mounted ref to prevent state updates after unmount

8. **Gemini: Add TextDecoder flush** (`api/src/providers/gemini.ts`)
   - Flush decoder after stream ends

### Low Priority

9. **ChatSidebar: Add localStorage try-catch** (`shared/pages/ChatSidebar/ChatSidebar.tsx`)
   - Wrap localStorage calls in try-catch for private browsing

10. **ChatSidebar: Distinguish API failure vs no models** (`shared/pages/ChatSidebar/ChatSidebar.tsx`)
    - Track error state separately from empty models

## Implementation Order

1. Create shared utils.ts (enables other fixes)
2. Fix Gemini provider (security + API spec)
3. Fix Anthropic provider (use shared utils)
4. Fix chat.ts (add timeout)
5. Fix ApiKeys.tsx (race condition + test dismiss + unmount)
6. Fix ChatSidebar.tsx (localStorage + error state)
