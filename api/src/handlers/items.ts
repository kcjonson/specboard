/**
 * Item handlers — unified work-item CRUD, lifecycle, children, and current-work.
 * Thin wrappers over the @specboard/db item service (which returns camelCase responses).
 *
 * Items are addressed by their key (`SB-345`). requireProjectAccess has already
 * resolved `:projectSlug` to the project on the context; these handlers turn the
 * `:itemKey` path segment into the per-project number the service works in.
 */

import type { Context } from 'hono';
import {
	getItems,
	createItem,
	createItems,
	updateItem,
	moveItem,
	wouldCreateCycle,
	deleteItem,
	startItem,
	completeItem,
	blockItem,
	unblockItem,
	verifyItemOwnership,
	getItemKeysBySpecPath,
	ParentItemNotFoundError,
	type ResolvedProject,
	type ItemStatus,
	type ItemType,
	type SubStatus,
} from '@specboard/db';
import { itemNumberInProject, parseItemKey } from '@specboard/core/identifiers';
import { isValidTitle, isValidType, isValidStatus, MAX_TITLE_LENGTH } from '../validation.ts';

/**
 * The project resolved from :projectSlug by requireProjectAccess.
 *
 * Throws rather than returning undefined: reaching here without it means the route
 * was registered without the wrapper, which would otherwise read as "authorized" and
 * query with an undefined project id. A 500 is the correct answer to that mistake.
 */
export function requireResolvedProject(context: Context): ResolvedProject {
	const resolved = context.get('project') as ResolvedProject | undefined;
	if (!resolved) throw new Error('Route is missing requireProjectAccess — no resolved project on context');
	return resolved;
}

const project = requireResolvedProject;

/**
 * The :itemKey path segment as a number, or an error Response.
 *
 * A key that isn't a key at all is a 400. A well-formed key carrying another
 * project's prefix is a 404 — the same answer as a number that doesn't exist here,
 * so the response can't be used to discover which prefixes are real.
 */
function pathItemNumber(context: Context): number | Response {
	const key = context.req.param('itemKey');
	if (!key || !parseItemKey(key)) return context.json({ error: 'Invalid item key' }, 400);

	const number = itemNumberInProject(key, project(context).key);
	if (number === null) return context.json({ error: 'Item not found' }, 404);
	return number;
}

/** GET /items — top-level items with child stats, filterable by status/type/search. */
export async function handleListItems(context: Context): Promise<Response> {
	const { id: projectId } = project(context);

	const status = context.req.query('status');
	const type = context.req.query('type');
	const search = context.req.query('search');
	const specPath = context.req.query('specPath');

	try {
		// Reverse lookup: items linking a given spec path (used by the doc editor).
		if (specPath) {
			const keys = await getItemKeysBySpecPath(projectId, specPath);
			return context.json(keys.map((key) => ({ key })));
		}
		const items = await getItems({
			projectId,
			status: isValidStatus(status) ? status : undefined,
			type: isValidType(type) ? type : undefined,
			search: search || undefined,
			limit: 500,
		});
		return context.json(items);
	} catch (error) {
		console.error('Failed to list items:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** GET /items/:itemKey — a single item with its children, notes, and specs. */
export async function handleGetItem(context: Context): Promise<Response> {
	const { id: projectId } = project(context);
	const itemNumber = pathItemNumber(context);
	if (typeof itemNumber !== 'number') return itemNumber;

	try {
		const items = await getItems({ projectId, itemNumber, includeChildren: true, includeNotes: true, includeSpecs: true });
		const item = items[0];
		if (!item) return context.json({ error: 'Item not found' }, 404);
		return context.json(item);
	} catch (error) {
		console.error('Failed to get item:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** GET /items/current — active (in_progress + in_review) and ready items. */
export async function handleGetCurrentWork(context: Context): Promise<Response> {
	const { id: projectId } = project(context);

	try {
		const [inProgress, inReview, ready] = await Promise.all([
			getItems({ projectId, status: 'in_progress', includeChildren: true, includeNotes: true }),
			getItems({ projectId, status: 'in_review', includeChildren: true }),
			getItems({ projectId, status: 'ready' }),
		]);
		return context.json({ active: [...inProgress, ...inReview], ready });
	} catch (error) {
		console.error('Failed to get current work:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** POST /items — create a top-level item or a child (when parentKey is given). */
export async function handleCreateItem(context: Context): Promise<Response> {
	const { id: projectId, key: projectKey } = project(context);

	const body = await context.req.json<{ title?: string; type?: unknown; parentKey?: string | null; description?: string; status?: unknown }>();
	const title = body.title || 'Untitled';
	if (!isValidTitle(title)) return context.json({ error: `Title must be between 1 and ${MAX_TITLE_LENGTH} characters` }, 400);
	if (body.type !== undefined && !isValidType(body.type)) return context.json({ error: 'Invalid type. Must be one of: epic, task, bug' }, 400);
	if (body.status !== undefined && !isValidStatus(body.status)) return context.json({ error: 'Invalid status' }, 400);

	let parentNumber: number | null = null;
	if (body.parentKey != null) {
		if (typeof body.parentKey !== 'string' || !parseItemKey(body.parentKey)) {
			return context.json({ error: 'Invalid parentKey' }, 400);
		}
		parentNumber = itemNumberInProject(body.parentKey, projectKey);
		if (parentNumber === null) return context.json({ error: 'Parent item not found' }, 404);
	}

	try {
		if (parentNumber !== null && !(await verifyItemOwnership(projectId, parentNumber))) {
			return context.json({ error: 'Parent item not found' }, 404);
		}
		const item = await createItem(projectId, {
			title,
			type: body.type as ItemType | undefined,
			parentNumber,
			description: body.description,
			status: body.status as ItemStatus | undefined,
		});
		return context.json(item, 201);
	} catch (error) {
		if (error instanceof ParentItemNotFoundError) return context.json({ error: 'Parent item not found' }, 404);
		console.error('Failed to create item:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** POST /items/:itemKey/children — bulk-create child items under a parent. */
export async function handleCreateChildren(context: Context): Promise<Response> {
	const { id: projectId } = project(context);
	const parentNumber = pathItemNumber(context);
	if (typeof parentNumber !== 'number') return parentNumber;

	const body = await context.req.json<{ items?: Array<{ title?: string; description?: string; type?: unknown }> }>();
	if (!Array.isArray(body.items) || body.items.length === 0) return context.json({ error: 'items array is required' }, 400);
	for (const it of body.items) {
		if (!it.title || !isValidTitle(it.title)) return context.json({ error: 'Each item needs a valid title' }, 400);
		if (it.type !== undefined && !isValidType(it.type)) return context.json({ error: 'Invalid type. Must be one of: epic, task, bug' }, 400);
	}

	try {
		if (!(await verifyItemOwnership(projectId, parentNumber))) return context.json({ error: 'Parent item not found' }, 404);
		const created = await createItems(
			projectId,
			parentNumber,
			body.items.map((it) => ({ title: it.title!, description: it.description, type: it.type as ItemType | undefined }))
		);
		return context.json(created, 201);
	} catch (error) {
		if (error instanceof ParentItemNotFoundError) return context.json({ error: 'Parent item not found' }, 404);
		console.error('Failed to create child items:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** PUT /items/:itemKey — update an item's fields. */
export async function handleUpdateItem(context: Context): Promise<Response> {
	const { id: projectId } = project(context);
	const itemNumber = pathItemNumber(context);
	if (typeof itemNumber !== 'number') return itemNumber;

	const body = await context.req.json<Record<string, unknown>>();
	if (body.status !== undefined && !isValidStatus(body.status)) return context.json({ error: 'Invalid status' }, 400);
	if (typeof body.title === 'string' && !isValidTitle(body.title)) return context.json({ error: 'Invalid title' }, 400);

	try {
		const item = await updateItem(projectId, itemNumber, {
			title: body.title as string | undefined,
			description: body.description as string | undefined,
			status: body.status as ItemStatus | undefined,
			subStatus: body.subStatus as SubStatus | undefined,
			rank: body.rank as number | undefined,
			prUrl: body.prUrl as string | undefined,
			branchName: body.branchName as string | undefined,
			notes: body.notes as string | undefined,
			note: body.note as string | undefined,
		});
		if (!item) return context.json({ error: 'Item not found' }, 404);
		return context.json(item);
	} catch (error) {
		console.error('Failed to update item:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** POST /items/:itemKey/move — reparent an item, or promote to top-level (parentKey null). */
export async function handleMoveItem(context: Context): Promise<Response> {
	const { id: projectId, key: projectKey } = project(context);
	const itemNumber = pathItemNumber(context);
	if (typeof itemNumber !== 'number') return itemNumber;

	const body = await context.req.json<{ parentKey?: string | null }>();
	let newParentNumber: number | null = null;
	if (body.parentKey != null) {
		if (typeof body.parentKey !== 'string' || !parseItemKey(body.parentKey)) {
			return context.json({ error: 'Invalid parentKey' }, 400);
		}
		newParentNumber = itemNumberInProject(body.parentKey, projectKey);
		if (newParentNumber === null) return context.json({ error: 'Parent item not found' }, 404);
	}
	if (newParentNumber === itemNumber) return context.json({ error: 'An item cannot be its own parent' }, 400);

	try {
		if (!(await verifyItemOwnership(projectId, itemNumber))) return context.json({ error: 'Item not found' }, 404);
		if (newParentNumber !== null && !(await verifyItemOwnership(projectId, newParentNumber))) {
			return context.json({ error: 'Parent item not found' }, 404);
		}
		if (newParentNumber !== null && (await wouldCreateCycle(projectId, itemNumber, newParentNumber))) {
			return context.json({ error: 'Cannot move an item under itself or one of its descendants' }, 400);
		}
		const item = await moveItem(projectId, itemNumber, newParentNumber);
		if (!item) return context.json({ error: 'Item not found' }, 404);
		return context.json(item);
	} catch (error) {
		if (error instanceof ParentItemNotFoundError) return context.json({ error: 'Parent item not found' }, 404);
		console.error('Failed to move item:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** DELETE /items/:itemKey — delete an item (children cascade). */
export async function handleDeleteItem(context: Context): Promise<Response> {
	const { id: projectId } = project(context);
	const itemNumber = pathItemNumber(context);
	if (typeof itemNumber !== 'number') return itemNumber;

	try {
		const deleted = await deleteItem(projectId, itemNumber);
		if (!deleted) return context.json({ error: 'Item not found' }, 404);
		return context.json({ success: true });
	} catch (error) {
		console.error('Failed to delete item:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

// ── Status lifecycle ────────────────────────────────────────────────────────

async function lifecycle(
	context: Context,
	run: (projectId: string, itemNumber: number, note: string | undefined) => Promise<unknown>,
	requireNote = false
): Promise<Response> {
	const { id: projectId } = project(context);
	const itemNumber = pathItemNumber(context);
	if (typeof itemNumber !== 'number') return itemNumber;

	let note: string | undefined;
	try {
		const body = await context.req.json<{ note?: string }>().catch(() => ({}) as { note?: string });
		note = typeof body.note === 'string' ? body.note : undefined;
	} catch {
		note = undefined;
	}
	if (requireNote && (!note || note.trim() === '')) return context.json({ error: 'note is required' }, 400);

	try {
		const item = await run(projectId, itemNumber, note);
		if (!item) return context.json({ error: 'Item not found' }, 404);
		return context.json(item);
	} catch (error) {
		console.error('Lifecycle update failed:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export const handleStartItem = (c: Context): Promise<Response> => lifecycle(c, (p, n) => startItem(p, n));
export const handleCompleteItem = (c: Context): Promise<Response> => lifecycle(c, (p, n, note) => completeItem(p, n, note));
export const handleBlockItem = (c: Context): Promise<Response> => lifecycle(c, (p, n, note) => blockItem(p, n, note!), true);
export const handleUnblockItem = (c: Context): Promise<Response> => lifecycle(c, (p, n) => unblockItem(p, n));
