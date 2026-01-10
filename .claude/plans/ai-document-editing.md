# COMPLETE - 2026-01-09

# AI Document Editing from Chat

Enable the AI chat sidebar to suggest and apply edits to the main document using search/replace blocks.

## Background

Currently, the ChatSidebar receives document content as read-only props. The AI can discuss the document but cannot modify it. This plan enables a "suggest and apply" workflow using targeted search/replace blocks.

## Design: Search/Replace Blocks

The AI will output targeted edits using a search/replace format:

```
I'll fix those typos for you:

<<<<<<< SEARCH
The quik brown fox jumps over the lazzy dog.
=======
The quick brown fox jumps over the lazy dog.
>>>>>>> REPLACE

<<<<<<< SEARCH
## Intrduction
=======
## Introduction
>>>>>>> REPLACE
```

**Why Search/Replace?**
- Efficient for large documents (only specify changes)
- Preserves unchanged content
- Clear what's being modified
- Industry standard (Cursor, Aider, Claude Code all use this)

**Matching Strategy:**
1. Exact match first
2. Whitespace-normalized match (ignore trailing spaces, line endings)
3. Fuzzy match if needed (for minor AI variations)

## Implementation Plan

### Phase 1: Update System Prompt

**File:** `api/src/handlers/chat.ts`

Update `buildSystemPrompt()`:

```typescript
let prompt = `You are a helpful AI writing assistant integrated into a document editor.
Your role is to help users with their documents - answering questions, suggesting improvements,
helping with structure, fixing grammar, and providing relevant information.

Keep your responses concise and focused on being helpful with the document at hand.
Use markdown formatting when appropriate.

When the user asks you to edit, rewrite, or modify part of the document, provide targeted
edits using SEARCH/REPLACE blocks:

<<<<<<< SEARCH
exact text to find in the document
=======
replacement text
>>>>>>> REPLACE

Important guidelines for edits:
- The SEARCH text must match EXACTLY what's in the document (including whitespace)
- Include enough context in SEARCH to uniquely identify the location
- You can include multiple SEARCH/REPLACE blocks for multiple changes
- For large rewrites, you may need several blocks

Example - fixing a typo:
<<<<<<< SEARCH
The quik brown fox
=======
The quick brown fox
>>>>>>> REPLACE

Example - adding a new section after existing content:
<<<<<<< SEARCH
## Conclusion

This wraps up our discussion.
=======
## Conclusion

This wraps up our discussion.

## References

1. Smith, J. (2024). Example Reference.
>>>>>>> REPLACE`;
```

### Phase 2: Parse Search/Replace Blocks

**New File:** `shared/pages/ChatSidebar/parseEdit.ts`

```typescript
export interface EditBlock {
  search: string;
  replace: string;
  matched: boolean;
  matchIndex?: number;  // Where in document the match was found
}

export interface ParsedEdits {
  blocks: EditBlock[];
  beforeText: string;
  afterText: string;
  stats: { insertions: number; deletions: number };
}

const EDIT_BLOCK_REGEX = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;

export function parseEditBlocks(content: string): EditBlock[] {
  const blocks: EditBlock[] = [];
  let match;

  while ((match = EDIT_BLOCK_REGEX.exec(content)) !== null) {
    blocks.push({
      search: match[1],
      replace: match[2],
      matched: false,
    });
  }

  return blocks;
}

export function matchBlocksToDocument(
  blocks: EditBlock[],
  document: string
): EditBlock[] {
  return blocks.map(block => {
    // Try exact match first
    const exactIndex = document.indexOf(block.search);
    if (exactIndex !== -1) {
      return { ...block, matched: true, matchIndex: exactIndex };
    }

    // Try whitespace-normalized match
    const normalizedSearch = block.search.trim().replace(/\s+/g, ' ');
    const normalizedDoc = document.replace(/\s+/g, ' ');
    const normalizedIndex = normalizedDoc.indexOf(normalizedSearch);
    if (normalizedIndex !== -1) {
      // Find actual position in original document
      const actualIndex = findActualPosition(document, block.search);
      if (actualIndex !== -1) {
        return { ...block, matched: true, matchIndex: actualIndex };
      }
    }

    return { ...block, matched: false };
  });
}

function findActualPosition(document: string, search: string): number {
  // Line-by-line matching with whitespace tolerance
  const searchLines = search.split('\n').map(l => l.trim());
  const docLines = document.split('\n');

  for (let i = 0; i <= docLines.length - searchLines.length; i++) {
    let matches = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (docLines[i + j].trim() !== searchLines[j]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      // Calculate character position
      return docLines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
    }
  }
  return -1;
}

export function computeStats(blocks: EditBlock[]): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;

  for (const block of blocks) {
    const searchLines = block.search.split('\n').length;
    const replaceLines = block.replace.split('\n').length;

    if (replaceLines > searchLines) {
      insertions += replaceLines - searchLines;
    } else if (searchLines > replaceLines) {
      deletions += searchLines - replaceLines;
    }
    // Count modified lines (lines that exist in both but differ)
    const minLines = Math.min(searchLines, replaceLines);
    // For simplicity, count each replacement as a modification
  }

  return { insertions, deletions };
}

export function applyEdits(document: string, blocks: EditBlock[]): string {
  let result = document;

  // Apply in reverse order of match position to preserve indices
  const sortedBlocks = [...blocks]
    .filter(b => b.matched && b.matchIndex !== undefined)
    .sort((a, b) => (b.matchIndex ?? 0) - (a.matchIndex ?? 0));

  for (const block of sortedBlocks) {
    const index = result.indexOf(block.search);
    if (index !== -1) {
      result = result.slice(0, index) + block.replace + result.slice(index + block.search.length);
    }
  }

  return result;
}
```

### Phase 3: Update ChatMessage Component

**File:** `shared/pages/ChatSidebar/ChatMessage.tsx`

1. Add props:
   - `onApplyEdit?: (newMarkdown: string) => void`
   - `currentDocument?: string`
2. Parse message for SEARCH/REPLACE blocks
3. Show compact edit card with stats

UI when edit blocks are detected:
```
[AI explanation text...]

┌─────────────────────────────────────────┐
│ 2 edits suggested       +3 lines -1 line│
│ [2 matched, 0 failed]        [Apply]    │
└─────────────────────────────────────────┘

[More response text if any...]
```

If any blocks fail to match:
```
┌─────────────────────────────────────────┐
│ 2 edits suggested       +3 lines -1 line│
│ [1 matched, 1 failed]        [Apply 1]  │
└─────────────────────────────────────────┘
```

### Phase 4: Wire Up Apply Callback

**File:** `shared/pages/ChatSidebar/ChatSidebar.tsx`

```typescript
interface ChatSidebarProps {
  documentContent?: string;
  documentPath?: string;
  onApplyEdit?: (markdown: string) => void;  // NEW
}
```

Pass `onApplyEdit` and `documentContent` to ChatMessage.

**File:** `shared/pages/Editor/Editor.tsx`

```typescript
const handleApplyEdit = useCallback((markdown: string) => {
  const { content: slateContent, comments } = fromMarkdown(markdown);
  documentModel.set({
    content: slateContent,
    comments,
    dirty: true
  });
}, [documentModel]);
```

### Phase 5: Styling

**File:** `shared/pages/ChatSidebar/ChatSidebar.module.css`

- `.editCard` - Compact card container
- `.editStats` - Green +N / Red -M styling
- `.editStatus` - "X matched, Y failed" text
- `.applyButton` - Primary action

## Files Modified

| File | Change |
|------|--------|
| `api/src/handlers/chat.ts` | Updated system prompt with SEARCH/REPLACE format |
| `shared/pages/ChatSidebar/parseEdit.ts` | NEW: Parse blocks, match, apply logic |
| `shared/pages/ChatSidebar/EditCard.tsx` | NEW: Edit card component |
| `shared/pages/ChatSidebar/EditCard.module.css` | NEW: Edit card styles |
| `shared/pages/ChatSidebar/ChatMessage.tsx` | Parse edits, render EditCard |
| `shared/pages/ChatSidebar/ChatSidebar.tsx` | Add `onApplyEdit` prop |
| `shared/pages/Editor/Editor.tsx` | Add `handleApplyEdit` callback |

## Verification

1. **Test: Single Edit**
   - Ask: "Fix the typo in the first paragraph"
   - Verify SEARCH/REPLACE block is parsed
   - Verify "1 edit suggested, 1 matched" shows
   - Click Apply, verify change is made

2. **Test: Multiple Edits**
   - Ask: "Fix all the grammar issues"
   - Verify multiple blocks are parsed
   - Verify stats show correct counts
   - Apply and verify all matched blocks are applied

3. **Test: Failed Match**
   - Manually modify document after AI responds
   - Verify "X failed" count updates
   - Verify Apply only applies matched blocks

4. **Test: Undo**
   - Apply edit, then Cmd+Z
   - Verify document reverts

## Edge Cases

- Empty SEARCH block → Skip
- Empty REPLACE block → Delete matched text
- No blocks detected → Render message normally
- All blocks fail to match → Disable Apply button, show error

## Future Enhancements

1. **Per-block approval** - Accept/reject individual blocks
2. **Inline diff preview** - Show what will change before applying
3. **Fuzzy matching** - Levenshtein distance for close matches
4. **Retry with context** - If match fails, ask AI to regenerate with more context
