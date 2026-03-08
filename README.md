# Specboard

Specboard is an integrated documentation and planning platform. It combines a Git-backed markdown editor with a lightweight task manager, designed for teams that want their specs and tasks to live together.

## Products

### Documentation Editor

A collaborative markdown editor built for technical documentation:

- **WYSIWYG and raw markdown modes** — switch between rich editing and direct markdown
- **Inline comments** — Google Docs-style margin comments with reply threads
- **AI assistance** — sidebar chat powered by Anthropic Claude and Google Gemini for writing help
- **Git-backed storage** — documents are markdown files in a GitHub repository, with full version history
- **Real-time sync** — edit in the browser, commit back to GitHub with conflict detection

### Planning Board

A kanban-style task manager with document integration:

- **Epic/task hierarchy** — organize work into epics with nested tasks
- **Three-column board** — drag-and-drop between status columns
- **Document linking** — connect specs to the epics and tasks they describe
- **MCP integration** — AI coding assistants (Claude Code) can read and update tasks via the Model Context Protocol

## How It Works

Specboard runs as a web application backed by AWS services. Users sign in, connect their GitHub repositories, and get a synced workspace where they can edit documents and manage tasks. Changes are stored in the cloud and can be committed back to GitHub.

For AI-assisted development workflows, the MCP server exposes planning data to tools like Claude Code, allowing AI agents to check current work, update task status, and read specs — creating a feedback loop between documentation, planning, and implementation.

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | System design, infrastructure, and monorepo structure |
| [Setup Guide](docs/setup.md) | Local development environment setup |
| [Tech Stack](docs/tech-stack.md) | Technology choices, coding standards, and conventions |
| [Project Status](docs/status.md) | Current development progress and roadmap |

Detailed feature specifications live in [`docs/specs/`](docs/specs/).

## Quick Start

Specboard runs entirely in Docker. No local Node.js installation required.

```bash
# Clone and start
git clone https://github.com/kcjonson/specboard.git
cd specboard
docker compose up

# Open in browser
open http://localhost
```

See the [Setup Guide](docs/setup.md) for full instructions including local overrides and database access.

## License

Private — not currently open source.
