/**
 * Work item MCP tools (unified)
 *
 * These tools provide a unified interface for all work items:
 * - get_items: Query items with flexible filtering, search, and optional includes
 * - create_item: Create epic/bug/task
 * - create_items: Bulk create tasks under a parent
 * - update_item: Update any item (status, sub_status, notes, etc.)
 * - delete_item: Delete any item
 */

import { resolveProjectSlug, type ResolvedProject } from '@specboard/db';

import { epicTools } from './definitions.ts';
import { getItems } from './reads.ts';
import { createItem, createItems, updateItem, deleteItem } from './writes.ts';

export type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

export { epicTools };

export async function handleEpicTool(
	name: string,
	args: Record<string, unknown> | undefined,
	userId: string,
	boundProjectSlug?: string
): Promise<ToolResult> {
	const requestedProjectSlug = args?.project_slug as string | undefined;

	// When the repo is bound (committed .mcp.json X-Specboard-Project header), the binding is
	// authoritative: reject an explicit project_slug that targets a different board, and fall back
	// to the binding when none is supplied so callers never have to repeat it.
	if (boundProjectSlug && requestedProjectSlug && requestedProjectSlug !== boundProjectSlug) {
		return {
			content: [
				{
					type: 'text',
					text: `This repo is bound to project ${boundProjectSlug} and cannot operate on project ${requestedProjectSlug}.`,
				},
			],
			isError: true,
		};
	}

	const projectSlug = requestedProjectSlug ?? boundProjectSlug;
	if (!projectSlug) {
		return {
			content: [{ type: 'text', text: 'project_slug is required' }],
			isError: true,
		};
	}

	// Security: resolve the slug within this user's projects. A miss covers both "project doesn't
	// exist" and "no access" — keep the message ambiguous between the two so it can't be used to
	// enumerate slugs (no existence disclosure, no echoing the slug back). When the project came
	// from the repo binding rather than an explicit project_slug, point at .mcp.json so a stale
	// committed slug is self-diagnosing instead of an opaque "access denied".
	const fromBinding = !requestedProjectSlug && Boolean(boundProjectSlug);
	const project: ResolvedProject | null = await resolveProjectSlug(projectSlug, userId);
	if (!project) {
		const text = fromBinding
			? "This repo's .mcp.json binding (X-Specboard-Project) points to a project that's unavailable — it may not exist, or your Specboard account may not have access to it. Verify the project slug committed in .mcp.json and that your account has access to that project."
			: "Access denied: that project doesn't exist, or your account doesn't have access to it.";
		return {
			content: [{ type: 'text', text }],
			isError: true,
		};
	}

	try {
		switch (name) {
			case 'get_items':
				return await getItems(project, args as Record<string, unknown>);
			case 'create_item':
				return await createItem(project, args);
			case 'create_items':
				return await createItems(project, args);
			case 'update_item':
				return await updateItem(project, args);
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
