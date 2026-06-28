/**
 * Read handler for work item MCP tools.
 *
 * Handles: get_items
 */

import {
	getItems as getItemsService,
	type ItemStatus,
	type ItemType,
} from '@specboard/db';

import type { ToolResult } from './index.ts';

export async function getItems(projectId: string, args: Record<string, unknown>): Promise<ToolResult> {
	const items = await getItemsService({
		projectId,
		itemId: args.item_id as string | undefined,
		status: args.status as ItemStatus | undefined,
		type: args.type as ItemType | undefined,
		search: args.search as string | undefined,
		includeChildren: args.include_children as boolean | undefined,
		includeNotes: args.include_notes as boolean | undefined,
		includeSpecs: true,
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
