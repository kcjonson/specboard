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
import { itemNumberInProject } from '@specboard/core/identifiers';

import type { ToolResult } from './index.ts';

export async function getItems(project: ResolvedProject, args: Record<string, unknown>): Promise<ToolResult> {
	// An item key from another project must not resolve here just because the number
	// exists. A non-string item_key is rejected too rather than silently listing.
	let itemNumber: number | undefined;
	if (args.item_key !== undefined && args.item_key !== null) {
		const parsed = itemNumberInProject(args.item_key, project.key);
		if (parsed === null) {
			return {
				content: [{ type: 'text', text: `${String(args.item_key)} is not an item key in project ${project.slug} (its items look like ${project.key}-1).` }],
				isError: true,
			};
		}
		itemNumber = parsed;
	}

	const { items, total } = await getItemsService({
		projectId: project.id,
		itemNumber,
		status: args.status as ItemStatus | undefined,
		type: args.type as ItemType | undefined,
		search: args.search as string | undefined,
		// Ready means actually startable: blocked items are excluded unless the
		// caller asks for them with include_blocked.
		excludeBlocked: args.status === 'ready' && args.include_blocked !== true,
		includeChildren: args.include_children as boolean | undefined,
		includeNotes: args.include_notes as boolean | undefined,
		includeSpecs: true,
		includeBlockers: itemNumber !== undefined,
		includeWorkers: itemNumber !== undefined,
		includeChecklist: itemNumber !== undefined || args.include_checklist === true,
		limit: args.limit as number | undefined,
	});

	return {
		content: [
			{
				type: 'text',
				// count is this page; total is every match, so an agent can see a limit cut the list.
				text: JSON.stringify({ items, count: items.length, total }, null, 2),
			},
		],
	};
}
