/**
 * Read handler for work item MCP tools.
 *
 * Handles: get_items
 */

import {
	getItems as getItemsService,
	type ResolvedProject,
	type ItemStatus,
	type ItemType,
} from '@specboard/db';
import { parseItemKey } from '@specboard/core/identifiers';

import type { ToolResult } from './index.ts';

export async function getItems(project: ResolvedProject, args: Record<string, unknown>): Promise<ToolResult> {
	// An item key from another project must not resolve here just because the number exists.
	let itemNumber: number | undefined;
	if (typeof args.item_key === 'string') {
		const parsed = parseItemKey(args.item_key);
		if (!parsed || parsed.projectKey !== project.key) {
			return {
				content: [{ type: 'text', text: `${args.item_key} is not an item key in project ${project.slug} (its items look like ${project.key}-1).` }],
				isError: true,
			};
		}
		itemNumber = parsed.number;
	}

	const items = await getItemsService({
		projectId: project.id,
		itemNumber,
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
