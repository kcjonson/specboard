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

import type { AgentActor, ProjectRole } from '@specboard/db';

import { resolveToolProject, type ProjectBinding, type ToolResult } from '../project-ref.ts';
import { epicTools } from './definitions.ts';
import { getItems } from './reads.ts';
import { createItem, createItems, updateItem, deleteItem } from './writes.ts';

export { epicTools };

/**
 * The least role each item tool needs on the project it addresses, the same matrix the
 * REST routes use: reads are viewer, writes are editor. A tool missing here can't be
 * called, and fails the role-matrix suite.
 */
export const epicToolMinRoles: Readonly<Record<string, ProjectRole>> = {
	get_items: 'viewer',
	create_item: 'editor',
	create_items: 'editor',
	update_item: 'editor',
	delete_item: 'editor',
};

export async function handleEpicTool(
	name: string,
	args: Record<string, unknown> | undefined,
	actor: AgentActor,
	binding: ProjectBinding
): Promise<ToolResult> {
	if (!Object.hasOwn(epicToolMinRoles, name)) {
		return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
	}

	const access = await resolveToolProject(args?.project, actor.userId, binding, epicToolMinRoles[name]!);
	if ('content' in access) return access;
	const { project } = access;

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
