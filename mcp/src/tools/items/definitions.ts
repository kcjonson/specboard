/**
 * MCP tool definitions for work items.
 *
 * Tool schemas only — handlers are in reads.ts and writes.ts.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const epicTools: Tool[] = [
	{
		name: 'get_items',
		description:
			'Query items (epics, tasks, bugs) with flexible filtering. Lists return top-level items with child stats. Optionally include each item\'s children and activity-log entries. Use item_key for a single item, or filter by status/type/search for lists.',
		inputSchema: {
			type: 'object',
			properties: {
				project_slug: {
					type: 'string',
					description:
						'The project slug (e.g. "specboard"), as shown in Specboard URLs. Optional when the repo is bound via .mcp.json (X-Specboard-Project) — the binding supplies it, and passing a different slug is refused.',
				},
				item_key: {
					type: 'string',
					description: 'Get a single item by its key (e.g. SB-345). When set, other filters are ignored.',
				},
				status: {
					type: 'string',
					enum: ['ready', 'in_progress', 'blocked', 'in_review', 'done'],
					description: 'Filter by board status',
				},
				type: {
					type: 'string',
					enum: ['epic', 'task', 'bug'],
					description: 'Filter by item type',
				},
				search: {
					type: 'string',
					description: 'Search title and description (case-insensitive)',
				},
				include_blocked: {
					type: 'boolean',
					description: 'status=ready normally excludes blocked items (open blockers); set true to include them.',
				},
				include_children: {
					type: 'boolean',
					description: 'Include child items for each item (default: false)',
				},
				include_notes: {
					type: 'boolean',
					description: 'Include the item\'s activity-log entries, newest first (default: false)',
				},
				limit: {
					type: 'number',
					description: 'Max items to return (default: 25)',
				},
			},
			required: [],
		},
	},
	{
		name: 'create_item',
		description:
			'Create an item. Epics are top-level containers; tasks and bugs can be top-level or nested under a parent (set parent_key).',
		inputSchema: {
			type: 'object',
			properties: {
				project_slug: {
					type: 'string',
					description:
						'The project slug (e.g. "specboard"), as shown in Specboard URLs. Optional when the repo is bound via .mcp.json (X-Specboard-Project) — the binding supplies it, and passing a different slug is refused.',
				},
				title: {
					type: 'string',
					description: 'Title for the item (max 255 chars)',
				},
				type: {
					type: 'string',
					enum: ['epic', 'bug', 'task'],
					description: 'Type of item. Defaults to "epic".',
				},
				parent_key: {
					type: 'string',
					description: 'Key of the item to nest this under (e.g. SB-12). Omit for a top-level item.',
				},
				description: {
					type: 'string',
					description: 'Description (for epics/bugs) or details (for tasks)',
				},
				specs: {
					type: 'array',
					description: 'Linked spec documents. Any item type can carry them, tasks included. Each path must start with / (e.g., /docs/specs/feature.md).',
					items: {
						type: 'object',
						properties: {
							path: { type: 'string', description: 'Spec file path, must start with /' },
							type: { type: 'string', enum: ['product', 'technical'], description: 'Spec type' },
						},
						required: ['path', 'type'],
					},
				},
				discovered_from: {
					type: 'string',
					description: 'Key of the item you were working on when this one was discovered (e.g. SB-12). Immutable provenance, set only at creation — pass it whenever you file follow-on work found mid-task.',
				},
				blockers: {
					type: 'array',
					description: 'Blockers the item starts with. Each entry is exactly one of { item_key } (blocked by that item; auto-clears when it completes) or { text } (a written reason; clears only when removed). Only record blockers the user or the work explicitly established — never infer them.',
					items: {
						type: 'object',
						properties: {
							item_key: { type: 'string', description: 'Key of the blocking item (e.g. SB-12)' },
							text: { type: 'string', description: 'Free-text reason' },
						},
					},
				},
			},
			required: ['title'],
		},
	},
	{
		name: 'create_items',
		description:
			'Bulk create tasks under a parent work item. Each item gets a title and optional details.',
		inputSchema: {
			type: 'object',
			properties: {
				project_slug: {
					type: 'string',
					description:
						'The project slug (e.g. "specboard"), as shown in Specboard URLs. Optional when the repo is bound via .mcp.json (X-Specboard-Project) — the binding supplies it, and passing a different slug is refused.',
				},
				parent_key: {
					type: 'string',
					description: 'Key of the parent work item, e.g. SB-12 (epic or bug)',
				},
				items: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							title: {
								type: 'string',
								description: 'Task title',
							},
							details: {
								type: 'string',
								description: 'Optional details',
							},
						},
						required: ['title'],
					},
					description: 'Array of tasks to create',
				},
				discovered_from: {
					type: 'string',
					description: 'Key of the item you were working on when these were discovered (e.g. SB-12). Shared by the whole batch; immutable provenance.',
				},
			},
			required: ['parent_key', 'items'],
		},
	},
	{
		name: 'update_item',
		description:
			'Update an item: title, description, status, sub_status, specs, blockers, branch_name, pr_url, note. note appends an entry to the item\'s activity log, never overwrites. Set parent_key to move it under another item, or parent_key null to promote it to top-level. Setting sub_status auto-updates board status (scoping/in_development/pr_open→in_progress, complete→done). blockers replaces the item\'s open blockers (item refs auto-clear when the blocking item completes; text clears only when removed).',
		inputSchema: {
			type: 'object',
			properties: {
				project_slug: {
					type: 'string',
					description:
						'The project slug (e.g. "specboard"), as shown in Specboard URLs. Optional when the repo is bound via .mcp.json (X-Specboard-Project) — the binding supplies it, and passing a different slug is refused.',
				},
				item_key: {
					type: 'string',
					description: 'Key of the item to update (e.g. SB-345)',
				},
				type: {
					type: 'string',
					enum: ['epic', 'bug', 'task'],
					description: 'Item type (optional, informational).',
				},
				parent_key: {
					type: 'string',
					description: 'Move the item under this parent (e.g. SB-12), or null to promote it to top-level.',
				},
				title: {
					type: 'string',
					description: 'New title',
				},
				description: {
					type: 'string',
					description: 'New description',
				},
				status: {
					type: 'string',
					description: 'New status: ready/in_progress/blocked/in_review/done. Any item type.',
				},
				sub_status: {
					type: 'string',
					enum: ['not_started', 'scoping', 'in_development', 'paused', 'needs_input', 'pr_open', 'complete'],
					description: 'Detailed work state. Auto-updates board status at key transitions.',
				},
				specs: {
					type: 'array',
					description: 'Linked spec documents. Any item type can carry them, tasks included. Replaces the full set — send all links to keep, or [] to clear. Each path must start with / (e.g., /docs/specs/feature.md).',
					items: {
						type: 'object',
						properties: {
							path: { type: 'string', description: 'Spec file path, must start with /' },
							type: { type: 'string', enum: ['product', 'technical'], description: 'Spec type' },
						},
						required: ['path', 'type'],
					},
				},
				branch_name: {
					type: 'string',
					description: 'Git branch name linked to this item',
				},
				pr_url: {
					type: 'string',
					description: 'Pull request URL',
				},
				note: {
					type: 'string',
					description: 'Append an entry to the item\'s activity log — what you did, decided, or are waiting on. Appended on every path, status changes and moves included; never overwrites an earlier entry. Required when status is blocked, unless blockers says why instead.',
				},
				blockers: {
					type: 'array',
					description: 'Replace the full set of the item\'s OPEN blockers — send everything that should still block, or [] to clear. Each entry is exactly one of { item_key } (blocked by that item; auto-clears when it completes) or { text } (a written reason; clears only by leaving this list). An item is blocked while any blocker is open. A non-empty array satisfies the reason requirement for status blocked, so no separate note is needed. Only record blockers the user or the work explicitly established — never infer them.',
					items: {
						type: 'object',
						properties: {
							item_key: { type: 'string', description: 'Key of the blocking item (e.g. SB-12)' },
							text: { type: 'string', description: 'Free-text reason' },
						},
					},
				},
			},
			required: ['item_key'],
		},
	},
	{
		name: 'delete_item',
		description:
			'Delete a work item or task.',
		inputSchema: {
			type: 'object',
			properties: {
				project_slug: {
					type: 'string',
					description:
						'The project slug (e.g. "specboard"), as shown in Specboard URLs. Optional when the repo is bound via .mcp.json (X-Specboard-Project) — the binding supplies it, and passing a different slug is refused.',
				},
				item_key: {
					type: 'string',
					description: 'Key of the item to delete (e.g. SB-345)',
				},
				type: {
					type: 'string',
					enum: ['epic', 'bug', 'task'],
					description: 'Type of item being deleted',
				},
			},
			required: ['item_key'],
		},
	},
];
