/**
 * Work item MCP tools (unified)
 *
 * These tools provide a unified interface for all work items:
 * - get_items: Query items with flexible filtering, search, and optional includes
 * - create_item: Create epic/bug/task
 * - create_items: Bulk create tasks under a parent
 * - update_item: Update any item (status, sub_status, note, etc.)
 * - delete_item: Delete any item
 */

import type { AgentActor } from '@specboard/db';

import { resolveToolProject, type ProjectBinding, type ToolResult } from '../project-ref.ts';
import { epicTools } from './definitions.ts';
import { getItems } from './reads.ts';
import { createItem, createItems, updateItem, deleteItem } from './writes.ts';

export { epicTools };

export async function handleEpicTool(
	name: string,
	args: Record<string, unknown> | undefined,
	actor: AgentActor,
	binding: ProjectBinding
): Promise<ToolResult> {
	const project = await resolveToolProject(args?.project, actor.userId, binding);
	if ('content' in project) return project;

	try {
		switch (name) {
			case 'get_items':
				return await getItems(project, args as Record<string, unknown>);
			case 'create_item':
				return await createItem(project, args, actor);
			case 'create_items':
				return await createItems(project, args, actor);
			case 'update_item':
				return await updateItem(project, args, actor);
			case 'delete_item':
				return await deleteItem(project, args);
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
