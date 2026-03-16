# AI Chat Interface Specification

This specification defines a chat interface as a top-level feature alongside Planning and Pages.

---

## Overview

A conversational AI interface for dumping thoughts, creating docs/epics, and managing work from natural language. Useful for rapid capture of ideas that the system internally routes to the right place (chore, doc, epic, task).

---

## Requirements

### Chat Tab
- Top-level navigation item alongside Planning and Pages
- Conversational interface with an AI agent
- Agent can create documents, epics, tasks, and chores from conversation
- Agent can read and reference existing project data

### Session Management
- Context length management and compaction
- Session history UI (list previous conversations)
- Ability to continue or start new sessions

### Background Processing
- Move AI chat to a web worker so users can switch to other documents while AI works
- Progress indication when AI is processing in background

### AI API
- App-level AI API key (not per-account) for small tasks
- Generate branch names, epic descriptions, and other metadata
- Lightweight inference separate from full chat sessions

---

## Dependencies

- REST API & Database
- Document AI Integration (for doc-aware features)

## Status

Needs design
