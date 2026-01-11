# COMPLETE - 2026-01-09

# Page Comments Implementation Plan

## Overview

Implement the ability to leave comments and respond to them on pages. Comments are stored in the markdown file itself as a hidden appendix (HTML comment containing JSON).

## Current State

### Already Implemented:
- **Comment Display UI** - `InlineComment.tsx` and `CommentsMargin.tsx` show comments in margin
- **Comment Highlighting** - `renderLeaf` applies yellow highlight + `data-comment-id` to commented text
- **Click Interaction** - Clicking highlights activates the corresponding comment
- **Comment Types** - `Comment` interface defined with id, text, author, timestamp, resolved, replies

### Missing (To Implement):
1. Comment storage in markdown file footer
2. Adding new comments (Cmd+Shift+M)
3. Replying to comments
4. Resolving/reopening comments
5. Serialization of comment ranges to/from line positions

## Spec Reference

From `/docs/specs/markdown-editor.md`:

**Storage Format:**
```markdown
# Document content...

<!-- COMMENTS:
[
  {
    "id": "comment-abc123",
    "range": {"startLine": 3, "startColumn": 26, "endLine": 3, "endColumn": 42},
    "text": "Consider rewording this section",
    "author": "Jane Doe",
    "authorEmail": "jane@example.com",
    "timestamp": "2025-12-19T10:30:00Z",
    "resolved": false,
    "replies": []
  }
]
-->
```

## Implementation Tasks

### Phase 1: Comment Serialization

**1.1 Update types** (`shared/pages/MarkdownEditor/types.ts`)
- Add `CommentRange` interface with startLine, startColumn, endLine, endColumn
- Add `CommentWithRange` type that extends Comment with range

**1.2 Create comment serialization** (`shared/pages/MarkdownEditor/serialization/comments.ts`)
- `parseCommentsFromMarkdown(markdown: string)` - Extract comments JSON from footer
- `appendCommentsToMarkdown(markdown: string, comments: CommentWithRange[])` - Add footer
- `stripCommentsFromMarkdown(markdown: string)` - Remove footer for parsing content

**1.3 Update fromMarkdown** (`shared/pages/MarkdownEditor/serialization/fromMarkdown.ts`)
- Strip comments footer before parsing
- Parse comments separately
- Apply `commentId` marks to Slate nodes based on line/column ranges
- Return `{ content: Descendant[], comments: Comment[] }`

**1.4 Update toMarkdown** (`shared/pages/MarkdownEditor/serialization/toMarkdown.ts`)
- Accept comments array as second parameter
- After serializing content, extract comment ranges from Slate positions
- Convert Slate paths to line/column positions
- Append comments footer

### Phase 2: Wire Up Data Flow

**2.1 Update DocumentModel** (`shared/models/src/DocumentModel.ts`)
- Add `comments: Comment[]` property
- Update `loadDocument()` to accept comments
- Add `savedComments` for dirty comparison

**2.2 Update Editor page** (`shared/pages/Editor/Editor.tsx`)
- Pass real comments to MarkdownEditor instead of mockComments
- Handle comment changes from editor
- Include comments in save flow

**2.3 Update MarkdownEditor** (`shared/pages/MarkdownEditor/MarkdownEditor.tsx`)
- Accept `onCommentsChange` callback
- Track comments in local state or pass through from model

### Phase 3: Add Comment UI

**3.1 Add Comment Toolbar Button** (`shared/pages/MarkdownEditor/Toolbar.tsx`)
- Add comment icon button
- Enable only when text is selected
- Call `onAddComment` when clicked

**3.2 Keyboard Shortcut** (`shared/pages/MarkdownEditor/MarkdownEditor.tsx`)
- Add Cmd+Shift+M hotkey
- Check for text selection
- Trigger add comment flow

**3.3 New Comment Input** (`shared/pages/MarkdownEditor/CommentsMargin.tsx`)
- Show input form when adding new comment
- Position near the selected text
- On submit: create comment, apply mark to selection, call onCommentsChange

**3.4 Reply UI** (`shared/pages/MarkdownEditor/InlineComment.tsx`)
- Add "Reply" button to each comment
- Show reply input form
- On submit: add reply to comment.replies array

**3.5 Resolve/Reopen** (`shared/pages/MarkdownEditor/InlineComment.tsx`)
- Add "Resolve" / "Reopen" button
- Toggle comment.resolved
- Visual styling for resolved comments (muted)

### Phase 4: Get Current User

**4.1 Use auth context for comment author**
- Get current user's name and email from session
- Pre-fill author/authorEmail when creating comments

## File Changes Summary

| File | Changes |
|------|---------|
| `types.ts` | Add CommentRange, CommentWithRange |
| `serialization/comments.ts` | NEW - comment parsing/serialization |
| `serialization/fromMarkdown.ts` | Parse comments, apply marks |
| `serialization/toMarkdown.ts` | Extract ranges, append footer |
| `serialization/index.ts` | Export new functions |
| `DocumentModel.ts` | Add comments property |
| `Editor.tsx` | Wire up real comments |
| `MarkdownEditor.tsx` | Add keyboard shortcut, onCommentsChange |
| `Toolbar.tsx` | Add comment button |
| `CommentsMargin.tsx` | Add new comment form |
| `InlineComment.tsx` | Add reply form, resolve button |
| `InlineComment.module.css` | Styles for new UI |
| `CommentsMargin.module.css` | Styles for new comment form |

## Testing Strategy

1. Unit tests for comment serialization (parse/stringify roundtrip)
2. Test comment range calculation (Slate position ↔ line/column)
3. Integration test: add comment, save, reload, verify comment present
4. Test edge cases: comments on formatted text, comments spanning lines

## Open Questions

1. **User identity**: Where do we get the current user's name/email? Need to check auth context.
2. **Comment deletion**: Should users be able to delete comments? (Not in spec, skip for now)
3. **Permissions**: Can anyone edit/resolve any comment, or only the author? (Start simple: anyone can)
