/**
 * Write handlers for work item MCP tools.
 *
 * Handles: create_item, create_items, update_item, delete_item.
 * Everything is an item; tasks/bugs differ from epics only by type and by having a parent.
 *
 * Items are addressed by key (`SB-345`). Each handler parses the keys it was given
 * against the resolved project's prefix, so a key from another board can't reach in.
 */

import {
	createItem as createItemService,
	createItems as createItemsService,
	updateItem as updateItemService,
	moveItem as moveItemService,
	wouldCreateCycle,
	deleteItem as deleteItemService,
	startItem as startItemService,
	completeItem as completeItemService,
	blockItem as blockItemService,
	unblockItem as unblockItemService,
	verifyItemOwnership,
	setSpecs as setSpecsService,
	SpecValidationError,
	type ResolvedProject,
	type ItemType,
	type ItemStatus,
	type SubStatus,
	type SpecType,
	type UpdateItemInput,
} from '@specboard/db';
import { parseItemKey } from '@specboard/core/identifiers';

import type { ToolResult } from './index.ts';

function ok(payload: unknown): ToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function err(text: string): ToolResult {
	return { content: [{ type: 'text', text }], isError: true };
}

/** Parse an item key against this project's prefix. Returns null when it isn't one of ours. */
function itemNumber(key: unknown, project: ResolvedProject): number | null {
	if (typeof key !== 'string') return null;
	const parsed = parseItemKey(key);
	if (!parsed || parsed.projectKey !== project.key) return null;
	return parsed.number;
}

/** The message for a key that doesn't address this project, so the fix is obvious. */
function badKey(key: unknown, project: ResolvedProject, label: string): ToolResult {
	return err(`${String(key)} is not a valid ${label} for project ${project.slug} (its items look like ${project.key}-1).`);
}

export async function createItem(
	project: ResolvedProject,
	args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
	const title = args?.title as string;
	if (!title) return err('title is required');

	const type = ((args?.type as string) || 'epic') as ItemType;
	const validTypes: ItemType[] = ['epic', 'task', 'bug'];
	if (!validTypes.includes(type)) return err('Invalid type. Must be one of: epic, task, bug');

	let parentNumber: number | null = null;
	if (args?.parent_key != null) {
		parentNumber = itemNumber(args.parent_key, project);
		if (parentNumber === null) return badKey(args.parent_key, project, 'parent_key');
		if (!(await verifyItemOwnership(project.id, parentNumber))) return err('Parent item not found');
	}

	const item = await createItemService(project.id, {
		title,
		type,
		parentNumber,
		description: args?.description as string | undefined,
	});

	// Optionally attach typed spec links.
	let specs;
	if (Array.isArray(args?.specs)) {
		try {
			specs = await setSpecsService(project.id, item.number, args.specs as Array<{ path: string; type: SpecType }>);
		} catch (error) {
			if (error instanceof SpecValidationError) return err(error.message);
			throw error;
		}
	}

	return ok({
		created: { key: item.key, title: item.title, type: item.type, status: item.status, parentId: item.parentId, ...(specs ? { specs } : {}) },
		message: `${type.charAt(0).toUpperCase() + type.slice(1)} created`,
	});
}

export async function createItems(
	project: ResolvedProject,
	args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
	const items = args?.items as Array<{ title: string; details?: string }>;
	if (args?.parent_key == null || !items || items.length === 0) return err('parent_key and items array are required');

	const parentNumber = itemNumber(args.parent_key, project);
	if (parentNumber === null) return badKey(args.parent_key, project, 'parent_key');
	if (!(await verifyItemOwnership(project.id, parentNumber))) return err('Parent item not found');

	const created = await createItemsService(
		project.id,
		parentNumber,
		items.map((it) => ({ title: it.title, description: it.details })),
	);

	return ok({ created: created.map((t) => ({ key: t.key, title: t.title, status: t.status })), count: created.length });
}

export async function updateItem(
	project: ResolvedProject,
	args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
	if (args?.item_key == null) return err('item_key is required');
	const number = itemNumber(args.item_key, project);
	if (number === null) return badKey(args.item_key, project, 'item_key');

	if (!(await verifyItemOwnership(project.id, number))) {
		return err('Access denied: item does not belong to this project');
	}

	// Reparent (move under another item) or promote to top-level (parent_key null).
	if (args.parent_key !== undefined) {
		let newParentNumber: number | null = null;
		if (args.parent_key !== null) {
			newParentNumber = itemNumber(args.parent_key, project);
			if (newParentNumber === null) return badKey(args.parent_key, project, 'parent_key');
			if (!(await verifyItemOwnership(project.id, newParentNumber))) return err('Parent item not found');
			if (await wouldCreateCycle(project.id, number, newParentNumber)) {
				return err('Cannot move an item under itself or one of its descendants');
			}
		}
		const moved = await moveItemService(project.id, number, newParentNumber);
		if (!moved) return err('Item not found');
		return ok({ updated: { key: moved.key, parentId: moved.parentId }, message: newParentNumber !== null ? 'Item moved' : 'Item promoted to top-level' });
	}

	const status = args.status as ItemStatus | undefined;
	const note = args.note as string | undefined;

	// Status-transition shortcuts.
	if (status === 'in_progress') {
		const item = await startItemService(project.id, number);
		if (note !== undefined) await updateItemService(project.id, number, { note });
		if (!item) return err('Item not found');
		return ok({ updated: { key: item.key, status: item.status }, message: 'Item started' });
	}
	if (status === 'done') {
		const item = await completeItemService(project.id, number, note);
		if (!item) return err('Item not found');
		return ok({ updated: { key: item.key, status: item.status, note: item.note }, message: 'Item completed' });
	}
	if (status === 'blocked') {
		if (!note) return err('note is required when blocking an item');
		const item = await blockItemService(project.id, number, note);
		if (!item) return err('Item not found');
		return ok({ updated: { key: item.key, status: item.status, note: item.note }, message: 'Item blocked' });
	}
	if (status === 'ready' && args.title === undefined && args.description === undefined && note === undefined) {
		const item = await unblockItemService(project.id, number);
		if (!item) return err('Item not found');
		return ok({ updated: { key: item.key, status: item.status }, message: 'Item unblocked' });
	}

	// General field update.
	const updateData: UpdateItemInput = {};
	if (args.title !== undefined) updateData.title = args.title as string;
	if (args.description !== undefined) updateData.description = args.description as string;
	if (status !== undefined) updateData.status = status;
	if (args.sub_status !== undefined) updateData.subStatus = args.sub_status as SubStatus;
	if (args.branch_name !== undefined) updateData.branchName = args.branch_name as string;
	if (args.pr_url !== undefined) updateData.prUrl = args.pr_url as string;
	if (args.notes !== undefined) updateData.notes = args.notes as string;
	if (note !== undefined) updateData.note = note;

	const item = await updateItemService(project.id, number, updateData);
	if (!item) return err('Item not found');

	// Replace the full set of typed spec links when provided.
	let specs;
	if (Array.isArray(args.specs)) {
		try {
			specs = await setSpecsService(project.id, number, args.specs as Array<{ path: string; type: SpecType }>);
		} catch (error) {
			if (error instanceof SpecValidationError) return err(error.message);
			throw error;
		}
	}

	return ok({
		updated: {
			key: item.key,
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
	project: ResolvedProject,
	args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
	if (args?.item_key == null) return err('item_key is required');
	const number = itemNumber(args.item_key, project);
	if (number === null) return badKey(args.item_key, project, 'item_key');

	if (!(await verifyItemOwnership(project.id, number))) {
		return err('Access denied: item does not belong to this project');
	}

	const deleted = await deleteItemService(project.id, number);
	return {
		content: [{ type: 'text', text: JSON.stringify({ deleted, message: deleted ? 'Item deleted' : 'Item not found' }, null, 2) }],
		isError: !deleted,
	};
}
