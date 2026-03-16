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
			'Query work items (epics, chores, bugs) with flexible filtering. Always returns task stats. Optionally include full task lists and progress notes. Use item_id for single-item lookup, or filter by status/type/search for lists.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: {
					type: 'string',
					description: 'The UUID of the project',
				},
				item_id: {
					type: 'string',
					description: 'Get a single item by ID. When set, other filters are ignored.',
				},
				status: {
					type: 'string',
					enum: ['ready', 'in_progress', 'in_review', 'done'],
					description: 'Filter by board status',
				},
				type: {
					type: 'string',
					enum: ['epic', 'chore', 'bug'],
					description: 'Filter by item type',
				},
				search: {
					type: 'string',
					description: 'Search title and description (case-insensitive)',
				},
				include_tasks: {
					type: 'boolean',
					description: 'Include task details for each item (default: false)',
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
			required: ['project_id'],
		},
	},
	{
		name: 'create_item',
		description:
			'Create a new work item. For epics/chores/bugs: creates a top-level item. For tasks: creates under a parent work item (parent_id required).',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: {
					type: 'string',
					description: 'The UUID of the project',
				},
				title: {
					type: 'string',
					description: 'Title for the item (max 255 chars)',
				},
				type: {
					type: 'string',
					enum: ['epic', 'chore', 'bug', 'task'],
					description: 'Type of item. Defaults to "epic".',
				},
				parent_id: {
					type: 'string',
					description: 'Parent work item ID (required when type=task, ignored otherwise)',
				},
				description: {
					type: 'string',
					description: 'Description (for epics/chores/bugs) or details (for tasks)',
				},
			},
			required: ['project_id', 'title'],
		},
	},
	{
		name: 'create_items',
		description:
			'Bulk create tasks under a parent work item. Each item gets a title and optional details.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: {
					type: 'string',
					description: 'The UUID of the project',
				},
				parent_id: {
					type: 'string',
					description: 'The UUID of the parent work item (epic, chore, or bug)',
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
			required: ['project_id', 'parent_id', 'items'],
		},
	},
	{
		name: 'update_item',
		description:
			'Update any work item or task. For work items (epic/chore/bug): supports title, description, status, sub_status, spec_doc_path, branch_name, pr_url, notes. Setting sub_status auto-updates board status (scoping/in_development/pr_open→in_progress, complete→done). For tasks: supports title, details, status (ready/in_progress/blocked/done), note.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: {
					type: 'string',
					description: 'The UUID of the project',
				},
				item_id: {
					type: 'string',
					description: 'The UUID of the item to update',
				},
				type: {
					type: 'string',
					enum: ['epic', 'chore', 'bug', 'task'],
					description: 'Type of item being updated — routes to correct table',
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
				spec_doc_path: {
					type: 'string',
					description: 'Path to the linked spec document (work items only). Must start with / (e.g., /docs/specs/feature.md). Send empty string to clear the link.',
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
			required: ['project_id', 'item_id', 'type'],
		},
	},
	{
		name: 'delete_item',
		description:
			'Delete a work item or task.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: {
					type: 'string',
					description: 'The UUID of the project',
				},
				item_id: {
					type: 'string',
					description: 'The UUID of the item to delete',
				},
				type: {
					type: 'string',
					enum: ['epic', 'chore', 'bug', 'task'],
					description: 'Type of item being deleted',
				},
			},
			required: ['project_id', 'item_id', 'type'],
		},
	},
];
