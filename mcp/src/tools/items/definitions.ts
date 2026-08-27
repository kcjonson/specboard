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
			'Query items (epics, tasks, bugs) with flexible filtering. Lists return top-level items with child stats. Optionally include each item\'s children and progress notes. Use item_key for a single item, or filter by status/type/search for lists.',
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
					enum: ['ready', 'in_progress', 'in_review', 'done'],
					description: 'Filter by board status',
				},
				type: {
					type: 'string',
					enum: ['epic', 'bug'],
					description: 'Filter by item type',
				},
				search: {
					type: 'string',
					description: 'Search title and description (case-insensitive)',
				},
				include_children: {
					type: 'boolean',
					description: 'Include child items for each item (default: false)',
				},
				include_notes: {
					type: 'boolean',
					description: 'Include progress notes for each item (default: false)',
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
			},
			required: ['parent_key', 'items'],
		},
	},
	{
		name: 'update_item',
		description:
			'Update an item: title, description, status, sub_status, specs, branch_name, pr_url, notes, note. Set parent_key to move it under another item, or parent_key null to promote it to top-level. Setting sub_status auto-updates board status (scoping/in_development/pr_open→in_progress, complete→done).',
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
					description: 'New description (work items) or details (tasks)',
				},
				status: {
					type: 'string',
					description: 'New status. Work items: ready/in_progress/in_review/done. Tasks: ready/in_progress/blocked/done.',
				},
				sub_status: {
					type: 'string',
					enum: ['not_started', 'scoping', 'in_development', 'paused', 'needs_input', 'pr_open', 'complete'],
					description: 'Detailed work state (work items only). Auto-updates board status at key transitions.',
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
					description: 'Git branch name linked to this item (work items only)',
				},
				pr_url: {
					type: 'string',
					description: 'Pull request URL (work items only)',
				},
				notes: {
					type: 'string',
					description: 'Append a note to the item (work items only). Auto-prepends timestamp.',
				},
				note: {
					type: 'string',
					description: 'Set note on a task — context for any outcome (completion, blocked, cut, etc.)',
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
