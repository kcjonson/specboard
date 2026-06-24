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
	userId: string,
	boundProjectId?: string
): Promise<ToolResult> {
	const requestedProjectId = args?.project_id as string | undefined;

	// When the repo is bound (committed .mcp.json X-Specboard-Project header), the binding is
	// authoritative: reject an explicit project_id that targets a different board, and fall back
	// to the binding when none is supplied so callers never have to repeat it.
	if (boundProjectId && requestedProjectId && requestedProjectId !== boundProjectId) {
		return {
			content: [
				{
					type: 'text',
					text: `This repo is bound to project ${boundProjectId} and cannot operate on project ${requestedProjectId}.`,
				},
			],
			isError: true,
		};
	}

	const projectId = requestedProjectId ?? boundProjectId;
	if (!projectId) {
		return {
			content: [{ type: 'text', text: 'project_id is required' }],
			isError: true,
		};
	}

	// Security: Verify the user has access to this project. verifyProjectAccess returns false for
	// both "project doesn't exist" and "no access" — keep the message ambiguous between the two so
	// it can't be used to enumerate valid project IDs (no existence disclosure, no echoing the ID
	// back). When the project came from the repo binding rather than an explicit project_id, point
	// at .mcp.json so a stale committed UUID is self-diagnosing instead of an opaque "access denied".
	const fromBinding = !requestedProjectId && Boolean(boundProjectId);
	const hasAccess = await verifyProjectAccess(projectId, userId);
	if (!hasAccess) {
		const text = fromBinding
			? "This repo's .mcp.json binding (X-Specboard-Project) points to a project that's unavailable — it may not exist, or your Specboard account may not have access to it. Verify the project UUID committed in .mcp.json and that your account has access to that project."
			: "Access denied: that project doesn't exist, or your account doesn't have access to it.";
		return {
			content: [{ type: 'text', text }],
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
