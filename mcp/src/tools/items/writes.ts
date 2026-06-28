/**
 * Write handlers for work item MCP tools.
 *
 * Handles: create_item, create_items, update_item, delete_item.
 * Everything is an item; tasks/bugs differ from epics only by type and by having a parent.
 */

import {
	createItem as createItemService,
	createItems as createItemsService,
	updateItem as updateItemService,
	moveItem as moveItemService,
	deleteItem as deleteItemService,
	startItem as startItemService,
	completeItem as completeItemService,
	blockItem as blockItemService,
	unblockItem as unblockItemService,
	verifyItemOwnership,
	setSpecs as setSpecsService,
	SpecValidationError,
	type ItemType,
	type ItemStatus,
	type SubStatus,
	type SpecType,
	type UpdateItemInput,
} from '@specboard/db';

import type { ToolResult } from './index.ts';

function ok(payload: unknown): ToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function err(text: string): ToolResult {
	return { content: [{ type: 'text', text }], isError: true };
}

export async function createItem(
	projectId: string,
	args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
	const title = args?.title as string;
	if (!title) return err('title is required');

	const type = ((args?.type as string) || 'epic') as ItemType;
	const validTypes: ItemType[] = ['epic', 'task', 'bug'];
	if (!validTypes.includes(type)) return err('Invalid type. Must be one of: epic, task, bug');

	const parentId = (args?.parent_id as string | undefined) ?? null;
	if (parentId && !(await verifyItemOwnership(projectId, parentId))) return err('Parent item not found');

	const item = await createItemService(projectId, {
		title,
		type,
		parentId,
		description: args?.description as string | undefined,
	});

	// Optionally attach typed spec links.
	let specs;
	if (Array.isArray(args?.specs)) {
		try {
			specs = await setSpecsService(projectId, item.id, args.specs as Array<{ path: string; type: SpecType }>);
		} catch (error) {
			if (error instanceof SpecValidationError) return err(error.message);
			throw error;
		}
	}

	return ok({
		created: { id: item.id, title: item.title, type: item.type, status: item.status, parentId: item.parentId, ...(specs ? { specs } : {}) },
		message: `${type.charAt(0).toUpperCase() + type.slice(1)} created`,
	});
}

export async function createItems(
	projectId: string,
	args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
	const parentId = args?.parent_id as string;
	const items = args?.items as Array<{ title: string; details?: string }>;

	if (!parentId || !items || items.length === 0) return err('parent_id and items array are required');
	if (!(await verifyItemOwnership(projectId, parentId))) return err('Parent item not found');

	const created = await createItemsService(
		projectId,
		parentId,
		items.map((it) => ({ title: it.title, description: it.details })),
	);

	return ok({ created: created.map((t) => ({ id: t.id, title: t.title, status: t.status })), count: created.length });
}

export async function updateItem(
	projectId: string,
	args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
	const itemId = args?.item_id as string;
	if (!itemId) return err('item_id is required');

	if (!(await verifyItemOwnership(projectId, itemId))) {
		return err('Access denied: item does not belong to this project');
	}

	// Reparent (move under another item) or promote to top-level (parent_id null).
	if (args?.parent_id !== undefined) {
		const newParentId = args.parent_id === null ? null : (args.parent_id as string);
		if (newParentId && !(await verifyItemOwnership(projectId, newParentId))) return err('Parent item not found');
		const moved = await moveItemService(projectId, itemId, newParentId);
		if (!moved) return err('Item not found');
		return ok({ updated: { id: moved.id, parentId: moved.parentId }, message: newParentId ? 'Item moved' : 'Item promoted to top-level' });
	}

	const status = args?.status as ItemStatus | undefined;
	const note = args?.note as string | undefined;

	// Status-transition shortcuts.
	if (status === 'in_progress') {
		const item = await startItemService(projectId, itemId);
		if (note !== undefined) await updateItemService(projectId, itemId, { note });
		if (!item) return err('Item not found');
		return ok({ updated: { id: item.id, status: item.status }, message: 'Item started' });
	}
	if (status === 'done') {
		const item = await completeItemService(projectId, itemId, note);
		if (!item) return err('Item not found');
		return ok({ updated: { id: item.id, status: item.status, note: item.note }, message: 'Item completed' });
	}
	if (status === 'blocked') {
		if (!note) return err('note is required when blocking an item');
		const item = await blockItemService(projectId, itemId, note);
		if (!item) return err('Item not found');
		return ok({ updated: { id: item.id, status: item.status, note: item.note }, message: 'Item blocked' });
	}
	if (status === 'ready' && args?.title === undefined && args?.description === undefined && note === undefined) {
		const item = await unblockItemService(projectId, itemId);
		if (!item) return err('Item not found');
		return ok({ updated: { id: item.id, status: item.status }, message: 'Item unblocked' });
	}

	// General field update.
	const updateData: UpdateItemInput = {};
	if (args?.title !== undefined) updateData.title = args.title as string;
	if (args?.description !== undefined) updateData.description = args.description as string;
	if (status !== undefined) updateData.status = status;
	if (args?.sub_status !== undefined) updateData.subStatus = args.sub_status as SubStatus;
	if (args?.branch_name !== undefined) updateData.branchName = args.branch_name as string;
	if (args?.pr_url !== undefined) updateData.prUrl = args.pr_url as string;
	if (args?.notes !== undefined) updateData.notes = args.notes as string;
	if (note !== undefined) updateData.note = note;

	const item = await updateItemService(projectId, itemId, updateData);
	if (!item) return err('Item not found');

	// Replace the full set of typed spec links when provided.
	let specs;
	if (Array.isArray(args?.specs)) {
		try {
			specs = await setSpecsService(projectId, itemId, args.specs as Array<{ path: string; type: SpecType }>);
		} catch (error) {
			if (error instanceof SpecValidationError) return err(error.message);
			throw error;
		}
	}

	return ok({
		updated: {
			id: item.id,
			title: item.title,
			status: item.status,
			subStatus: item.subStatus,
			branchName: item.branchName,
			prUrl: item.prUrl,
			...(specs ? { specs } : {}),
		},
		message: 'Item updated',
	});
}

export async function deleteItem(
	projectId: string,
	args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
	const itemId = args?.item_id as string;
	if (!itemId) return err('item_id is required');

	if (!(await verifyItemOwnership(projectId, itemId))) {
		return err('Access denied: item does not belong to this project');
	}

	const deleted = await deleteItemService(projectId, itemId);
	return {
		content: [{ type: 'text', text: JSON.stringify({ deleted, message: deleted ? 'Item deleted' : 'Item not found' }, null, 2) }],
		isError: !deleted,
	};
}
