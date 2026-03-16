/**
 * Work item MCP tools (unified)
 *
 * These tools provide a unified interface for all work items:
 * - get_items: Query items with flexible filtering, search, and optional includes
 * - create_item: Create epic/chore/bug/task
 * - create_items: Bulk create tasks under a parent
 * - update_item: Update any item (status, sub_status, notes, etc.)
 * - delete_item: Delete any item
 */

import { verifyProjectAccess } from '@specboard/db';

import { epicTools } from './definitions.ts';
import { getItems } from './reads.ts';
import { createItem, createItems, updateItem, deleteItem } from './writes.ts';

export type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

export { epicTools };

export async function handleEpicTool(
	name: string,
	args: Record<string, unknown> | undefined,
	userId: string
): Promise<ToolResult> {
	const projectId = args?.project_id as string;
	if (!projectId) {
		return {
			content: [{ type: 'text', text: 'project_id is required' }],
			isError: true,
		};
	}

	// Security: Verify the user has access to this project
	const hasAccess = await verifyProjectAccess(projectId, userId);
	if (!hasAccess) {
		return {
			content: [{ type: 'text', text: 'Access denied: You do not have permission to access this project' }],
			isError: true,
		};
	}

	try {
		switch (name) {
			case 'get_items':
				return await getItems(projectId, args as Record<string, unknown>);
			case 'create_item':
				return await createItem(projectId, args);
			case 'create_items':
				return await createItems(projectId, args);
			case 'update_item':
				return await updateItem(projectId, args);
			case 'delete_item':
				return await deleteItem(projectId, args);
			default:
				return {
					content: [{ type: 'text', text: `Unknown tool: ${name}` }],
					isError: true,
				};
		}
	} catch (error) {
		return {
			content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
			isError: true,
		};
	}
}
