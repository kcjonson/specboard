/**
 * Item handlers — unified work-item CRUD, lifecycle, children, and current-work.
 * Thin wrappers over the @specboard/db item service (which returns camelCase responses).
 */

import type { Context } from 'hono';
import {
	getItems,
	createItem,
	createItems,
	updateItem,
	moveItem,
	deleteItem,
	startItem,
	completeItem,
	blockItem,
	unblockItem,
	verifyItemOwnership,
	getItemIdsBySpecPath,
	type ItemStatus,
	type ItemType,
	type SubStatus,
} from '@specboard/db';
import { isValidUUID, isValidTitle, isValidType, isValidStatus, MAX_TITLE_LENGTH } from '../validation.ts';

/** GET /items — top-level items with child stats, filterable by status/type/search. */
export async function handleListItems(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	if (!isValidUUID(projectId)) return context.json({ error: 'Invalid project ID format' }, 400);

	const status = context.req.query('status');
	const type = context.req.query('type');
	const search = context.req.query('search');
	const specPath = context.req.query('specPath');

	try {
		// Reverse lookup: items linking a given spec path (used by the doc editor).
		if (specPath) {
			const ids = await getItemIdsBySpecPath(projectId, specPath);
			return context.json(ids.map((id) => ({ id })));
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

/** GET /items/:id — a single item with its children, notes, and specs. */
export async function handleGetItem(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const id = context.req.param('id');
	if (!isValidUUID(projectId) || !isValidUUID(id)) return context.json({ error: 'Invalid ID format' }, 400);

	try {
		const items = await getItems({ projectId, itemId: id, includeChildren: true, includeNotes: true, includeSpecs: true });
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
	const projectId = context.req.param('projectId');
	if (!isValidUUID(projectId)) return context.json({ error: 'Invalid project ID format' }, 400);

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

/** POST /items — create a top-level item or a child (when parentId is given). */
export async function handleCreateItem(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	if (!isValidUUID(projectId)) return context.json({ error: 'Invalid project ID format' }, 400);

	const body = await context.req.json<{ title?: string; type?: unknown; parentId?: string | null; description?: string; status?: unknown }>();
	const title = body.title || 'Untitled';
	if (!isValidTitle(title)) return context.json({ error: `Title must be between 1 and ${MAX_TITLE_LENGTH} characters` }, 400);
	if (body.type !== undefined && !isValidType(body.type)) return context.json({ error: 'Invalid type. Must be one of: epic, task, bug' }, 400);
	if (body.status !== undefined && !isValidStatus(body.status)) return context.json({ error: 'Invalid status' }, 400);
	if (body.parentId != null && !isValidUUID(body.parentId)) return context.json({ error: 'Invalid parentId format' }, 400);

	try {
		if (body.parentId && !(await verifyItemOwnership(projectId, body.parentId))) {
			return context.json({ error: 'Parent item not found' }, 404);
		}
		const item = await createItem(projectId, {
			title,
			type: body.type as ItemType | undefined,
			parentId: body.parentId ?? null,
			description: body.description,
			status: body.status as ItemStatus | undefined,
		});
		return context.json(item, 201);
	} catch (error) {
		console.error('Failed to create item:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** POST /items/:id/children — bulk-create child items under a parent. */
export async function handleCreateChildren(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const parentId = context.req.param('id');
	if (!isValidUUID(projectId) || !isValidUUID(parentId)) return context.json({ error: 'Invalid ID format' }, 400);

	const body = await context.req.json<{ items?: Array<{ title?: string; description?: string; type?: unknown }> }>();
	if (!Array.isArray(body.items) || body.items.length === 0) return context.json({ error: 'items array is required' }, 400);
	for (const it of body.items) {
		if (!it.title || !isValidTitle(it.title)) return context.json({ error: 'Each item needs a valid title' }, 400);
		if (it.type !== undefined && !isValidType(it.type)) return context.json({ error: 'Invalid type. Must be one of: epic, task, bug' }, 400);
	}

	try {
		if (!(await verifyItemOwnership(projectId, parentId))) return context.json({ error: 'Parent item not found' }, 404);
		const created = await createItems(
			projectId,
			parentId,
			body.items.map((it) => ({ title: it.title!, description: it.description, type: it.type as ItemType | undefined }))
		);
		return context.json(created, 201);
	} catch (error) {
		console.error('Failed to create child items:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** PUT /items/:id — update an item's fields. */
export async function handleUpdateItem(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const id = context.req.param('id');
	if (!isValidUUID(projectId) || !isValidUUID(id)) return context.json({ error: 'Invalid ID format' }, 400);

	const body = await context.req.json<Record<string, unknown>>();
	if (body.status !== undefined && !isValidStatus(body.status)) return context.json({ error: 'Invalid status' }, 400);
	if (typeof body.title === 'string' && !isValidTitle(body.title)) return context.json({ error: 'Invalid title' }, 400);

	try {
		const item = await updateItem(projectId, id, {
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

/** POST /items/:id/move — reparent an item, or promote to top-level (parentId null). */
export async function handleMoveItem(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const id = context.req.param('id');
	if (!isValidUUID(projectId) || !isValidUUID(id)) return context.json({ error: 'Invalid ID format' }, 400);

	const body = await context.req.json<{ parentId?: string | null }>();
	const newParentId = body.parentId ?? null;
	if (newParentId !== null && !isValidUUID(newParentId)) return context.json({ error: 'Invalid parentId format' }, 400);
	if (newParentId === id) return context.json({ error: 'An item cannot be its own parent' }, 400);

	try {
		if (!(await verifyItemOwnership(projectId, id))) return context.json({ error: 'Item not found' }, 404);
		if (newParentId && !(await verifyItemOwnership(projectId, newParentId))) return context.json({ error: 'Parent item not found' }, 404);
		const item = await moveItem(projectId, id, newParentId);
		if (!item) return context.json({ error: 'Item not found' }, 404);
		return context.json(item);
	} catch (error) {
		console.error('Failed to move item:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** DELETE /items/:id — delete an item (children cascade). */
export async function handleDeleteItem(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const id = context.req.param('id');
	if (!isValidUUID(projectId) || !isValidUUID(id)) return context.json({ error: 'Invalid ID format' }, 400);

	try {
		const deleted = await deleteItem(projectId, id);
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
	run: (projectId: string, id: string, note: string | undefined) => Promise<unknown>,
	requireNote = false
): Promise<Response> {
	const projectId = context.req.param('projectId');
	const id = context.req.param('id');
	if (!isValidUUID(projectId) || !isValidUUID(id)) return context.json({ error: 'Invalid ID format' }, 400);

	let note: string | undefined;
	try {
		const body = await context.req.json<{ note?: string }>().catch(() => ({}) as { note?: string });
		note = typeof body.note === 'string' ? body.note : undefined;
	} catch {
		note = undefined;
	}
	if (requireNote && (!note || note.trim() === '')) return context.json({ error: 'note is required' }, 400);

	try {
		const item = await run(projectId, id, note);
		if (!item) return context.json({ error: 'Item not found' }, 404);
		return context.json(item);
	} catch (error) {
		console.error('Lifecycle update failed:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export const handleStartItem = (c: Context): Promise<Response> => lifecycle(c, (p, id) => startItem(p, id));
export const handleCompleteItem = (c: Context): Promise<Response> => lifecycle(c, (p, id, note) => completeItem(p, id, note));
export const handleBlockItem = (c: Context): Promise<Response> => lifecycle(c, (p, id, note) => blockItem(p, id, note!), true);
export const handleUnblockItem = (c: Context): Promise<Response> => lifecycle(c, (p, id) => unblockItem(p, id));
