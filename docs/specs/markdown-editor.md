# Markdown Editor Specification

This specification defines the architecture and behavior for the dual-mode markdown editor, the core component of the documentation product.

---

## Overview

A Slate.js-based editor that provides:
- **WYSIWYG mode**: Rich text editing with formatting toolbar
- **Raw mode**: Markdown syntax with syntax highlighting
- **Unified commenting**: Same comment system works in both modes
- **Controlled state**: External state store owns the document

Both modes edit the same underlying Slate document, with different rendering approaches.

---

## Architecture

### High-Level Component Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                        MarkdownEditor                            │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                      Toolbar                                │ │
│  │   [B] [I] [U] [H1] [H2] [Link] [Code] ... [Mode Toggle]    │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─────────────────────────────┐ ┌──────────────────────────┐  │
│  │                             │ │                          │  │
│  │     Editor Area             │ │    Comment Panel         │  │
│  │                             │ │                          │  │
│  │  (Slate Editable)           │ │    - Comment 1           │  │
│  │                             │ │    - Comment 2           │  │
│  │  Renders in either:         │ │    - ...                 │  │
│  │  - WYSIWYG mode             │ │                          │  │
│  │  - Raw markdown mode        │ │                          │  │
│  │                             │ │                          │  │
│  └─────────────────────────────┘ └──────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### State Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    DocumentModel (external)                   │
│                                                               │
│   content: string          // Markdown source                 │
│   comments: Comment[]      // Comment data                    │
│   $meta.working: boolean   // Sync status                     │
│                                                               │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    MarkdownEditor Component                   │
│                                                               │
│   slateValue: Descendant[]  // Parsed from markdown           │
│   mode: 'wysiwyg' | 'raw'   // Current edit mode              │
│   activeComment: string     // Selected comment ID            │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### Serialization Pipeline

```
Markdown String
       │
       ▼ (on load / mode switch to WYSIWYG)
┌─────────────────┐
│  remark-parse   │  Parse markdown to AST
│  remark-gfm     │  GitHub Flavored Markdown
│  remark-slate   │  Convert to Slate nodes
└─────────────────┘
       │
       ▼
Slate Descendant[]
       │
       ▼ (on save / mode switch to Raw)
┌─────────────────┐
│  slate-remark   │  Convert Slate to AST
│  remark-gfm     │  GitHub Flavored Markdown
│  remark-stringify│  Serialize to string
└─────────────────┘
       │
       ▼
Markdown String
```

---

## Slate Document Model

### Node Types

The editor supports these element types:

| Element | Description | Markdown |
|---------|-------------|----------|
| paragraph | Basic text block | Plain text |
| heading | H1-H6 headers | `# ## ### ...` |
| blockquote | Quote block | `>` |
| code | Code block with language | ` ``` ` |
| list | Ordered/unordered list | `- *` or `1.` |
| list-item | Individual list item | Child of list |
| link | Inline/block link | `[text](url)` |
| image | Image embed | `![alt](src)` |
| table | Table with rows/cells | `|---|` |
| thematic-break | Horizontal rule | `---` |

### Text Marks

Text can have multiple marks applied:

| Mark | Description | Markdown |
|------|-------------|----------|
| bold | Strong emphasis | `**text**` |
| italic | Emphasis | `*text*` |
| code | Inline code | `` `text` `` |
| strikethrough | Strikethrough | `~~text~~` |
| comment | Has comment attached | (custom mark) |

### Comment Mark

Comments are attached to text ranges via a special mark:
- `comment: true` - Indicates text has a comment
- `commentId: string` - Links to comment data

---

## Dual-Mode Rendering

### WYSIWYG Mode

Renders Slate nodes as rich HTML elements:
- Headings render as `<h1>` through `<h6>`
- Code blocks show syntax highlighting via Prism
- Links are clickable
- Images show inline previews
- Comment highlights show yellow background

### Raw Mode

Renders the same Slate document as markdown source:
- All elements render as plain text divs
- Prism tokenizes markdown syntax for highlighting
- Comment highlights still visible on relevant text ranges
- Cursor position preserved during mode switch (best effort)

### Mode Switching Behavior

1. Serialize current Slate value to markdown string
2. Update mode state
3. Re-render with appropriate render functions
4. Map cursor position to equivalent location in new mode

---

## Comment System

### Comment Data Structure

```
Comment:
  id: string
  text: string
  author: string
  authorEmail: string
  timestamp: ISO 8601 string
  resolved: boolean
  replies: Comment[]

CommentRange:
  commentId: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
```

### Comment Storage

Comments are stored in the markdown file footer as an HTML comment containing JSON:

```markdown
# Document Title

Document content here with [highlighted text] that has comments.

---

<!-- COMMENTS:
[
  {
    "id": "comment-abc123",
    "range": {"startLine": 3, "startColumn": 26, "endLine": 3, "endColumn": 42},
    "text": "Consider rewording this section",
    "author": "Jane Doe",
    "timestamp": "2025-12-19T10:30:00Z",
    "resolved": false,
    "replies": []
  }
]
-->
```

### Comment Panel Behavior

The panel renders alongside the editor and:
- Lists all comments for the document
- Highlights active comment when clicked
- Shows visual connector line to highlighted text
- Allows adding replies
- Supports resolving/reopening comments

### Adding Comments Flow

1. User selects text in editor
2. User triggers "Add Comment" (Cmd+Shift+M or context menu)
3. Comment input appears in panel
4. On submit:
   - Generate unique comment ID
   - Apply comment mark to selected text
   - Store comment data in document footer
   - Scroll panel to show new comment

---

## Read-only mode

The editor mounts with `readOnly` for someone who can't edit the project (`useProjectRole`,
[multi-user-collaboration.md](./multi-user-collaboration.md)): no toolbar, no new comments,
replies or resolving (existing comments still render), no rename, epic create or link, no AI
edit to apply, and no recovery of a local draft, which stays in local storage until they can
save it. The file browser drops commit, pull, the pending-changes count, and file and folder
create, rename and delete. A member of a local project sees a note that its documents are on
the owner's computer in place of the tree.

## Keyboard Shortcuts

### Formatting Shortcuts

| Shortcut | Action | Works in Raw? |
|----------|--------|---------------|
| `Cmd+B` | Bold | Yes (wraps with **) |
| `Cmd+I` | Italic | Yes (wraps with *) |
| `Cmd+U` | Underline | No (not standard markdown) |
| `Cmd+K` | Insert link | Yes |
| `Cmd+Shift+C` | Code block | Yes |
| `Cmd+Shift+M` | Add comment | Yes |
| `Cmd+/` | Toggle mode | Yes |

### Navigation Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+P` | Quick open file |
| `Cmd+Shift+P` | Command palette |
| `Cmd+S` | Save (commit) |

---

## AI Integration Points

### Context Menu Actions

When text is selected, these AI actions are available:

| Action | Description |
|--------|-------------|
| Improve writing | Enhance clarity and professionalism |
| Simplify | Make text more concise |
| Expand | Add more detail |
| Explain | Generate explanation of selected text |

### AI Diff Rendering

When AI suggests changes:
1. Show inline diff comparing original to suggested
2. Deletions: red background with strikethrough
3. Additions: green background with underline
4. User can accept or reject suggestion

### Bedrock Integration

AI calls go through backend API which proxies to Amazon Bedrock Claude:
- `POST /api/ai/generate` with prompt and document context
- Response contains suggested text
- Frontend renders diff for user approval

---

## Preact Integration

### Component Props

```
MarkdownEditorProps:
  value: string              // Markdown source
  onChange: (markdown) => void
  comments: Comment[]
  onCommentsChange: (comments) => void
  mode: 'wysiwyg' | 'raw'    // Optional, controlled
  onModeChange: (mode) => void
```

### Integration with Model Pattern

The editor integrates with the SyncModel state management:
- DocumentModel owns the content and comments
- Editor receives value/onChange for controlled behavior
- Changes sync automatically via SyncModel infrastructure

---

## Dependencies

| Package | Purpose |
|---------|---------|
| slate | Editor framework |
| slate-react | React/Preact bindings |
| slate-history | Undo/redo |
| remark-slate-transformer | Markdown ↔ Slate conversion |
| remark-parse | Markdown parser |
| remark-stringify | Markdown serializer |
| remark-gfm | GitHub Flavored Markdown support |
| unified | Processing pipeline |
| prismjs | Syntax highlighting |

---

## File Structure

```
packages/editor/
├── src/
│   ├── index.ts                 # Public exports
│   ├── MarkdownEditor.tsx       # Main component
│   ├── types.ts                 # TypeScript types
│   ├── plugins/
│   │   ├── withMarkdown.ts      # Markdown behaviors
│   │   ├── withComments.ts      # Comment system
│   │   └── withKeyboard.ts      # Keyboard shortcuts
│   ├── render/
│   │   ├── wysiwyg.tsx          # WYSIWYG renderers
│   │   ├── raw.tsx              # Raw mode renderers
│   │   └── decorate.ts          # Prism decorations
│   ├── serialization/
│   │   ├── toMarkdown.ts        # Slate → Markdown
│   │   ├── fromMarkdown.ts      # Markdown → Slate
│   │   └── comments.ts          # Comment serialization
│   ├── components/
│   │   ├── Toolbar.tsx
│   │   ├── CommentPanel.tsx
│   │   ├── CommentThread.tsx
│   │   └── AIContextMenu.tsx
│   └── styles/
│       ├── editor.module.css
│       ├── toolbar.module.css
│       ├── comments.module.css
│       └── prism-markdown.css
├── package.json
└── tsconfig.json
```

---

## Open Questions

1. **Preact compatibility**: Need to verify slate-react works with preact/compat. May need patching.

2. **Large document performance**: Prism decoration on every keystroke may need caching/virtualization for large docs.

3. **Collaborative editing**: Not in MVP, but architecture should not preclude future CRDTs.

4. **Image handling**: External URLs only for MVP. Future: upload to S3.

---

## References

- [Slate.js Documentation](https://docs.slatejs.org)
- [Slate Code Highlighting Example](https://www.slatejs.org/examples/code-highlighting)
- [remark-slate-transformer](https://github.com/inokawa/remark-slate-transformer)
- [Prism.js Markdown Grammar](https://prismjs.com/components/prism-markdown.js)
