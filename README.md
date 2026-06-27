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

## Claude Code Integration

Specboard ships a plugin for [Claude Code](https://claude.ai/code) that connects your AI coding sessions to your planning board. It bundles two skills — `/specboard:whats-next` (discover work, scope it, break it down, keep board status accurate) and `/specboard:complete` (verify, finalize the PR, and close out the epic) — together with the MCP server connection, so one install wires up everything.

### Setup

**Install the plugin:**

```
/plugin marketplace add https://specboard.io/claude
/plugin install specboard@specboard
```

This registers the Specboard MCP server (`https://specboard.io/mcp`) and installs the workflow skill. On first connect, the OAuth flow handles authentication automatically.

**Bind a repo to a project (optional):** to make the skill always target one project in a given
repo, commit a project-scoped `.mcp.json` at the repo root carrying that project's UUID:

```json
{ "mcpServers": { "specboard": { "type": "http", "url": "https://specboard.io/mcp", "headers": { "X-Specboard-Project": "<project-uuid>" } } } }
```

This project-scoped entry overrides the plugin's server in that repo, so reconnect the MCP after
adding it. **On first connect it runs its own one-time OAuth** — the plugin server's token does not
carry over to the project-scoped one, so expect a sign-in prompt (and a trust prompt for the new
server). The UUID is a shared reference, not a credential — each user still authenticates
individually, and access is checked per user against that project.

### Usage

From any project directory in Claude Code:

```
/specboard:whats-next
```

The skill also activates automatically when you're doing Specboard work. It will:
1. Query your Specboard projects via MCP
2. Check local git state (branches, worktrees, PRs)
3. Cross-reference to identify active, paused, and available work
4. Recommend what to work on next

During a session, Claude uses the Specboard MCP tools to track progress — scoping work, breaking it into tasks, keeping status accurate, linking branches, and opening (and, when verified, merging) PRs.

### MCP Tools

| Tool | Description |
|------|-------------|
| `list_projects` | Discover your projects and their IDs |
| `get_items` | Query items with filtering by status, type, search; optional task/note includes |
| `create_item` | Create an epic, chore, bug, or task |
| `create_items` | Bulk create tasks under a work item |
| `update_item` | Update status, sub-status, branch, notes, etc. |
| `delete_item` | Delete a work item or task |

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | System design, infrastructure, and monorepo structure |
| [Setup Guide](docs/setup.md) | Local development environment setup |
| [Tech Stack](docs/tech-stack.md) | Technology choices, coding standards, and conventions |
| [Deployment](docs/deployment.md) | How to deploy to staging and production |

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
