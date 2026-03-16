# Document AI Integration Specification

This specification defines how AI interacts with documents, comments, and user-selected context.

---

## Overview

Enhance the document editing experience with AI capabilities: reading and responding to inline comments, user-controlled context documents, and lightweight AI-assisted metadata generation.

---

## Requirements

### Comment Interaction
- AI can read inline comments on documents
- AI can respond to comments (threaded replies)
- User can trigger AI review of comments

### Always-in-Context Documents
- User selects which documents should always be in AI context (e.g., writing guidelines)
- Stored per-project
- Context documents loaded automatically for AI interactions

### AI-Assisted Metadata
- Generate branch names from epic/task titles
- Generate epic descriptions from brief input
- Other small inference tasks that don't require full chat sessions

---

## Dependencies

- Markdown Editor
- AI Chat Interface

## Status

Needs design
