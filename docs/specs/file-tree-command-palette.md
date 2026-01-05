# File Tree & Command Palette Specification

This specification defines the file tree sidebar and command palette for the documentation editor.

> **Related Spec**: See [Project Storage](./project-storage.md) for how projects connect to git repositories and folder management.

---

## File Tree Sidebar

### Purpose

Allow users to navigate and manage files in their documentation repository.

### Project Connection

Before the file tree displays content, the project must be connected to a git repository:

**Local Mode:**
1. User clicks "Add Folder" button
2. User selects a folder on their local filesystem
3. Backend validates folder is in a git repository
4. Files from that folder appear in the tree

**Cloud Mode:**
1. User connects a GitHub repository in project settings
2. Backend clones repository to managed storage
3. Files appear in the tree

See [Project Storage](./project-storage.md) for validation rules and API details.

### Layout

**Empty State (no folders added):**
```
┌──────────────────────┐
│  FILES               │
│  ────────────────────│
│                      │
│   No folders added   │
│                      │
│   [+ Add Folder]     │
│                      │
│   Add a folder from  │
│   a git repository   │
│   to get started.    │
│                      │
└──────────────────────┘
```

**With Files:**
```
┌──────────────────────┐
│  🔍 Search files...  │  ← Filter input
│  ────────────────────│
│                      │
│  ▼ 📁 docs           │  ← Root path folder
│    ▼ 📁 requirements │
│      📄 auth.md     ◀│  ← Selected file indicator
│      📄 api.md       │
│    ▶ 📁 specs        │  ← Collapsed folder
│    📄 README.md      │
│  ▶ 📁 guides         │
│                      │
│  ────────────────────│
│  [+ Add Folder]      │  ← Add another folder (same repo)
└──────────────────────┘
```

### Features

**Navigation:**
- Click folder to expand/collapse
- Click file to open in editor
- Current file is highlighted
- Keyboard arrow keys to navigate

**File Operations (Context Menu):**
- New File
- New Folder
- Rename (F2)
- Delete (with confirmation)
- Copy Path
- Reveal in Finder (Desktop only)

**Root Path Operations (Context Menu on root folder):**
- Remove from Project (removes from view, doesn't delete files)
- Open in Terminal (Desktop only)
- Copy Path

**Search:**
- Filter input at top
- Filters tree as you type
- Shows matching files only

**Visual Indicators:**
- Different icons for file types (📄 .md, 📋 .json, etc.)
- Open/closed folder icons (📁/📂)
- Indentation shows hierarchy
- Modified indicator (dot) for unsaved files

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `↑` / `↓` | Navigate items |
| `→` | Expand folder |
| `←` | Collapse folder |
| `Enter` | Open file / Toggle folder |
| `F2` | Rename |
| `Delete` | Delete (with confirmation) |

---

## Quick Open (Cmd+P)

### Purpose

Quickly find and open any file without navigating the tree.

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  🔍 auth                                                        │
│  ───────────────────────────────────────────────────────────────│
│                                                                 │
│  📄 auth.md                                        requirements │  ← Selected
│  📄 auth-flow.md                                          specs │
│  📄 authentication.md                                     guides │
│                                                                 │
│  ↑↓ navigate · Enter open · Esc close                          │
└─────────────────────────────────────────────────────────────────┘
```

### Features

- Opens with Cmd+P
- Fuzzy search across all file names
- Shows file name + parent folder
- Recent files shown when empty
- Results ranked by relevance

### Behavior

1. Press Cmd+P → Modal opens with focus on input
2. Type to search → Results update live
3. Arrow keys to select → Highlighted result changes
4. Enter → Opens file, closes modal
5. Escape → Closes modal

---

## Command Palette (Cmd+K)

### Purpose

Universal launcher for all actions in the application.

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  > toggle                                                       │
│  ───────────────────────────────────────────────────────────────│
│                                                                 │
│  🔄 Toggle Edit Mode                                   Cmd+/    │  ← Selected
│  📋 Toggle Sidebar                                     Cmd+B    │
│  👁 Toggle Preview                                              │
│                                                                 │
│  ↑↓ navigate · Enter run · Esc close                           │
└─────────────────────────────────────────────────────────────────┘
```

### Command Categories

**File:**
- New Document (Cmd+N)
- New Folder
- Save (Cmd+S)
- Save All (Cmd+Shift+S)

**Edit:**
- Undo (Cmd+Z)
- Redo (Cmd+Shift+Z)
- Find (Cmd+F)
- Find and Replace (Cmd+H)

**View:**
- Toggle Edit Mode (Cmd+/)
- Toggle Sidebar (Cmd+B)
- Toggle Comments Panel

**Git:**
- Commit Changes (Cmd+Enter)
- View Diff
- Push to Remote
- Pull from Remote

**Comments:**
- Add Comment (Cmd+Shift+M)
- Next Comment
- Previous Comment
- Resolve Comment

**AI:**
- Improve Writing
- Simplify Text
- Expand Text
- Review Document
- Open AI Chat

**Navigation:**
- Go to Line (Cmd+G)
- Go to Symbol
- Quick Open (Cmd+P)

### Features

- Opens with Cmd+K
- Fuzzy search across command names
- Shows keyboard shortcuts
- Groups commands by category
- Recently used commands at top
- Context-aware (some commands only when applicable)

---

## Design Specifications

### File Tree

| Property | Value |
|----------|-------|
| Width | 260px (resizable 200-400px) |
| Background | Sidebar color |
| Item height | 28px |
| Icon size | 16px |
| Indent per level | 16px |

### Quick Open / Command Palette

| Property | Value |
|----------|-------|
| Width | 560px |
| Max height | 400px |
| Position | Centered, 100px from top |
| Backdrop | 50% black overlay |
| Border radius | 8px |
| Shadow | Large drop shadow |

### Colors (from design system)

| Element | Color |
|---------|-------|
| Selected item | Primary/10% opacity |
| Hover | Neutral/5% opacity |
| Shortcut text | Muted text |
| Category header | Muted text, uppercase |

---

## Accessibility

- Full keyboard navigation
- Focus visible on all items
- Screen reader labels for icons
- Escape closes modals
- Focus trapped in modals when open

---

## Related Shortcuts Summary

| Shortcut | Action |
|----------|--------|
| `Cmd+P` | Quick Open |
| `Cmd+K` | Command Palette |
| `Cmd+B` | Toggle Sidebar |
| `Cmd+S` | Save |
| `Cmd+/` | Toggle Edit Mode |
| `Cmd+Shift+M` | Add Comment |
| `Cmd+G` | Go to Line |
| `F2` | Rename (in file tree) |
