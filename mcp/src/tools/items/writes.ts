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
	setBlockers as setBlockersService,
	recordWorkerActivity,
	endWorkers,
	SpecValidationError,
	BlockerValidationError,
	BlockerConflictError,
	BlockerTargetError,
	ParentItemNotFoundError,
	DiscoveredFromNotFoundError,
	ItemCycleError,
	type ResolvedProject,
	type ItemType,
	type ItemStatus,
	type SubStatus,
	type SpecType,
	type UpdateItemInput,
	type AgentActor,
	type BlockerInput,
} from '@specboard/db';
import { itemNumberInProject } from '@specboard/core/identifiers';

import type { ToolResult } from './index.ts';

function ok(payload: unknown): ToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function err(text: string): ToolResult {
	return { content: [{ type: 'text', text }], isError: true };
}

/** The message for a key that doesn't address this project, so the fix is obvious. */
function badKey(key: unknown, project: ResolvedProject, label: string): ToolResult {
	return err(`${String(key)} is not a valid ${label} for project ${project.slug} (its items look like ${project.key}-1).`);
}

/**
 * Parse a `blockers` array of `{ item_key }` / `{ text }` entries into service
 * inputs, validating item keys against this project's prefix.
 */
function parseBlockers(raw: unknown[], project: ResolvedProject): BlockerInput[] | ToolResult {
	const inputs: BlockerInput[] = [];
	for (const entry of raw) {
		const b = entry as { item_key?: unknown; text?: unknown };
		if (b.item_key != null) {
			const number = itemNumberInProject(b.item_key, project.key);
			if (number === null) return badKey(b.item_key, project, 'blocker item_key');
			inputs.push({ itemNumber: number });
		} else if (typeof b.text === 'string' && b.text.trim().length > 0) {
			inputs.push({ text: b.text.trim() });
		} else {
			return err('Each blocker is exactly one of: { item_key } or { text }');
		}
	}
	return inputs;
}

/** The optional discovered_from arg as a per-project number, or an error result. */
function parseDiscoveredFrom(args: Record<string, unknown> | undefined, project: ResolvedProject): number | undefined | ToolResult {
	if (args?.discovered_from == null) return undefined;
	const number = itemNumberInProject(args.discovered_from, project.key);
	if (number === null) return badKey(args.discovered_from, project, 'discovered_from');
	return number;
}

export async function createItem(
	project: ResolvedProject,
	args: Record<string, unknown> | undefined,
	actor: AgentActor,
): Promise<ToolResult> {
	const title = args?.title as string;
	if (!title) return err('title is required');

	const type = ((args?.type as string) || 'epic') as ItemType;
	const validTypes: ItemType[] = ['epic', 'task', 'bug'];
	if (!validTypes.includes(type)) return err('Invalid type. Must be one of: epic, task, bug');

	let parentNumber: number | null = null;
	if (args?.parent_key != null) {
		parentNumber = itemNumberInProject(args.parent_key, project.key);
		if (parentNumber === null) return badKey(args.parent_key, project, 'parent_key');
		if (!(await verifyItemOwnership(project.id, parentNumber))) return err('Parent item not found');
	}

	const discoveredFromNumber = parseDiscoveredFrom(args, project);
	if (typeof discoveredFromNumber === 'object') return discoveredFromNumber;

	let item;
	try {
		item = await createItemService(project.id, {
			title,
			type,
			parentNumber,
			description: args?.description as string | undefined,
			origin: { actor },
			discoveredFromNumber,
		});
	} catch (error) {
		if (error instanceof ParentItemNotFoundError) return err('Parent item not found');
		if (error instanceof DiscoveredFromNotFoundError) return err('Discovered-from item not found');
		throw error;
	}

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

	// Optionally record blockers the item is created with.
	let blockers;
	if (Array.isArray(args?.blockers) && args.blockers.length > 0) {
		const inputs = parseBlockers(args.blockers, project);
		if (!Array.isArray(inputs)) return inputs;
		try {
			blockers = await setBlockersService(project.id, item.number, inputs, actor);
		} catch (error) {
			if (error instanceof BlockerValidationError || error instanceof BlockerTargetError) return err(error.message);
			throw error;
		}
	}

	return ok({
		created: { key: item.key, title: item.title, type: item.type, status: item.status, parentKey: item.parentKey, ...(specs ? { specs } : {}), ...(blockers ? { blockers, blocked: true } : {}) },
		message: `${type.charAt(0).toUpperCase() + type.slice(1)} created`,
	});
}

export async function createItems(
	project: ResolvedProject,
	args: Record<string, unknown> | undefined,
	actor: AgentActor,
): Promise<ToolResult> {
	const items = args?.items as Array<{ title: string; details?: string }>;
	if (args?.parent_key == null || !items || items.length === 0) return err('parent_key and items array are required');

	const parentNumber = itemNumberInProject(args.parent_key, project.key);
	if (parentNumber === null) return badKey(args.parent_key, project, 'parent_key');
	if (!(await verifyItemOwnership(project.id, parentNumber))) return err('Parent item not found');

	const discoveredFromNumber = parseDiscoveredFrom(args, project);
	if (typeof discoveredFromNumber === 'object') return discoveredFromNumber;

	let created;
	try {
		created = await createItemsService(
			project.id,
			parentNumber,
			items.map((it) => ({ title: it.title, description: it.details })),
			{ actor },
			discoveredFromNumber,
		);
	} catch (error) {
		if (error instanceof ParentItemNotFoundError) return err('Parent item not found');
		if (error instanceof DiscoveredFromNotFoundError) return err('Discovered-from item not found');
		throw error;
	}

	return ok({ created: created.map((t) => ({ key: t.key, title: t.title, status: t.status })), count: created.length });
}

export async function updateItem(
	project: ResolvedProject,
	args: Record<string, unknown> | undefined,
	actor: AgentActor,
): Promise<ToolResult> {
	if (args?.item_key == null) return err('item_key is required');
	const number = itemNumberInProject(args.item_key, project.key);
	if (number === null) return badKey(args.item_key, project, 'item_key');

	if (!(await verifyItemOwnership(project.id, number))) {
		return err('Access denied: item does not belong to this project');
	}

	// Reparent (move under another item) or promote to top-level (parent_key null).
	if (args.parent_key !== undefined) {
		let newParentNumber: number | null = null;
		if (args.parent_key !== null) {
			newParentNumber = itemNumberInProject(args.parent_key, project.key);
			if (newParentNumber === null) return badKey(args.parent_key, project, 'parent_key');
			if (!(await verifyItemOwnership(project.id, newParentNumber))) return err('Parent item not found');
			if (await wouldCreateCycle(project.id, number, newParentNumber)) {
				return err('Cannot move an item under itself or one of its descendants');
			}
		}
		let moved;
		try {
			moved = await moveItemService(project.id, number, newParentNumber);
		} catch (error) {
			if (error instanceof ParentItemNotFoundError) return err('Parent item not found');
			if (error instanceof ItemCycleError) return err(error.message);
			throw error;
		}
		if (!moved) return err('Item not found');
		return ok({ updated: { key: moved.key, parentKey: moved.parentKey }, message: newParentNumber !== null ? 'Item moved' : 'Item promoted to top-level' });
	}

	const status = args.status as ItemStatus | undefined;
	const note = args.note as string | undefined;

	// Status-transition shortcuts.
	if (status === 'in_progress') {
		const item = await startItemService(project.id, number);
		if (note !== undefined) await updateItemService(project.id, number, { note });
		if (!item) return err('Item not found');
		await recordWorkerActivity(project.id, number, actor, args.branch_name as string | undefined);
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
		// This session stepped away from the item; end its worker episode.
		await endWorkers(project.id, number, actor.sessionId);
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

	// Replace the full set of OPEN blockers when provided. Item blockers auto-clear
	// when the blocking item completes; text blockers only clear by leaving this list.
	let blockers;
	if (Array.isArray(args.blockers)) {
		const inputs = parseBlockers(args.blockers, project);
		if (!Array.isArray(inputs)) return inputs;
		try {
			blockers = await setBlockersService(project.id, number, inputs, actor);
		} catch (error) {
			if (error instanceof BlockerValidationError || error instanceof BlockerTargetError) return err(error.message);
			if (error instanceof BlockerConflictError) return err(error.message);
			throw error;
		}
	}

	// Observed worker presence: a write that leaves the item in_progress marks this
	// session active on it; a write that moves it to ready/in_review ends the episode
	// (done ends every session's episode inside the service).
	if (item.status === 'in_progress') {
		await recordWorkerActivity(project.id, number, actor, args.branch_name as string | undefined);
	} else if (status !== undefined && (item.status === 'ready' || item.status === 'in_review')) {
		await endWorkers(project.id, number, actor.sessionId);
	}

	return ok({
		updated: {
			key: item.key,
			title: item.title,
			status: item.status,
			subStatus: item.subStatus,
			branchName: item.branchName,
			prUrl: item.prUrl,
			blocked: blockers ? blockers.length > 0 || item.status === 'blocked' : item.blocked,
			...(specs ? { specs } : {}),
			...(blockers ? { blockers } : {}),
		},
		message: 'Item updated',
	});
}

export async function deleteItem(
	project: ResolvedProject,
	args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
	if (args?.item_key == null) return err('item_key is required');
	const number = itemNumberInProject(args.item_key, project.key);
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
