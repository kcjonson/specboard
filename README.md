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

Specboard ships with a `/whats-next` command for [Claude Code](https://claude.ai/code) that connects your AI coding sessions to your planning board. It queries Specboard's MCP server to show current work, suggest what to pick up next, and manage the full development lifecycle — from scoping to PR.

### Setup

**1. Register the Specboard MCP server:**

```bash
claude mcp add specboard --url https://specboard.io/mcp
```

The OAuth flow will handle authentication automatically.

**2. Install the `/whats-next` command and helper script:**

```bash
# From the specboard repo root
mkdir -p ~/.claude/commands ~/.claude/scripts
ln -sf "$(pwd)/tools/whats-next.md" ~/.claude/commands/whats-next.md
ln -sf "$(pwd)/tools/assess-git-state.sh" ~/.claude/scripts/assess-git-state.sh
```

**3. Add MCP tool permissions** to your Claude Code settings (global or per-project `.claude/settings.local.json`):

```json
{
  "permissions": {
    "allow": [
      "Skill(whats-next)",
      "Bash(bash ~/.claude/scripts/assess-git-state.sh)",
      "mcp__specboard__list_projects",
      "mcp__specboard__get_current_work",
      "mcp__specboard__get_ready_epics",
      "mcp__specboard__get_epic",
      "mcp__specboard__create_item",
      "mcp__specboard__create_items",
      "mcp__specboard__update_item",
      "mcp__specboard__delete_item"
    ]
  }
}
```

### Usage

From any project directory in Claude Code:

```
/whats-next
```

This will:
1. Query your Specboard projects via MCP
2. Check local git state (branches, worktrees, PRs)
3. Cross-reference to identify active, paused, and available work
4. Recommend what to work on next

During a session, Claude uses the Specboard MCP tools to track progress — starting tasks, adding notes on completion, linking branches, and signaling PRs for review.

### MCP Tools

| Tool | Description |
|------|-------------|
| `list_projects` | Discover your projects and their IDs |
| `get_current_work` | In-progress and in-review items with task stats |
| `get_ready_epics` | Available work items to pick up |
| `get_epic` | Full details of a work item including tasks |
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
