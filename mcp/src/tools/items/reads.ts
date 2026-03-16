/**
 * Read handler for work item MCP tools.
 *
 * Handles: get_items
 */

import {
	getItems as getItemsService,
	type EpicStatus,
	type EpicType,
} from '@specboard/db';

import type { ToolResult } from './index.ts';

export async function getItems(projectId: string, args: Record<string, unknown>): Promise<ToolResult> {
	const items = await getItemsService({
		projectId,
		itemId: args.item_id as string | undefined,
		status: args.status as EpicStatus | undefined,
		type: args.type as EpicType | undefined,
		search: args.search as string | undefined,
		includeTasks: args.include_tasks as boolean | undefined,
		includeNotes: args.include_notes as boolean | undefined,
		limit: args.limit as number | undefined,
	});

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify({ items, count: items.length }, null, 2),
			},
		],
	};
}
