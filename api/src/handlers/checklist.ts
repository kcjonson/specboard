/**
 * Checklist handlers — the ordered scratch todos on an item (items.checklist).
 *
 * A sub-resource rather than a prop on the item model, for the reason the
 * activity log is one: SyncModel.save() PUTs the WHOLE model, so a `checklist`
 * prop would echo the browser's copy of the array back on every title,
 * description, or status edit and clobber whatever an agent set in between.
 * Ticking one box also wants an entry-addressable write — a whole-array PUT
 * reintroduces exactly the clobbering the entry-level SQL in the service exists
 * to prevent. So `handleGetItem` does not load the checklist, and the browser
 * reads and writes it here, the way it does /specs, /blockers, and /notes.
 *
 * Entries carry no actor internals to strip, so they serialize as-is — there is
 * no apiChecklistEntry mapper the way notes and blockers have one.
 */

import type { Context } from 'hono';
import {
	getChecklist,
	addChecklistEntry,
	updateChecklistEntry,
	removeChecklistEntry,
	ChecklistValidationError,
	type ChecklistStatus,
} from '@specboard/db';
import { requireResolvedProject, pathItemNumber } from './items.ts';

/** The parsed request body, or a 400 Response when it isn't JSON at all. */
async function jsonBody<T>(context: Context): Promise<T | Response> {
	try {
		return await context.req.json<T>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}
}

/** GET /items/:itemKey/checklist — every entry, in display order. */
export async function handleListChecklist(context: Context): Promise<Response> {
	const { id: projectId } = requireResolvedProject(context);
	const itemNumber = pathItemNumber(context);
	if (typeof itemNumber !== 'number') return itemNumber;

	try {
		const entries = await getChecklist(projectId, itemNumber);
		if (!entries) return context.json({ error: 'Item not found' }, 404);
		return context.json(entries);
	} catch (error) {
		console.error('Failed to list checklist:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** POST /items/:itemKey/checklist — append one entry. */
export async function handleAddChecklistEntry(context: Context): Promise<Response> {
	const { id: projectId } = requireResolvedProject(context);
	const itemNumber = pathItemNumber(context);
	if (typeof itemNumber !== 'number') return itemNumber;

	const body = await jsonBody<{ text?: unknown }>(context);
	if (body instanceof Response) return body;
	if (typeof body.text !== 'string') return context.json({ error: 'text is required' }, 400);

	try {
		const entry = await addChecklistEntry(projectId, itemNumber, body.text);
		if (!entry) return context.json({ error: 'Item not found' }, 404);
		return context.json(entry, 201);
	} catch (error) {
		if (error instanceof ChecklistValidationError) return context.json({ error: error.message }, 400);
		console.error('Failed to add checklist entry:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** PUT /items/:itemKey/checklist/:id — patch one entry's text and/or status. */
export async function handleUpdateChecklistEntry(context: Context): Promise<Response> {
	const { id: projectId } = requireResolvedProject(context);
	const itemNumber = pathItemNumber(context);
	if (typeof itemNumber !== 'number') return itemNumber;

	const entryId = context.req.param('id');
	if (!entryId) return context.json({ error: 'Invalid checklist entry ID' }, 400);

	const body = await jsonBody<{ text?: unknown; status?: unknown }>(context);
	if (body instanceof Response) return body;

	// Only fields actually supplied reach the service, so a toggle sending
	// { status } alone cannot blank the entry's text.
	const changes: { text?: string; status?: ChecklistStatus } = {};
	if (typeof body.text === 'string') changes.text = body.text;
	// The service owns which statuses exist; the handler only forwards a string,
	// so widening the set never needs an edit here.
	if (typeof body.status === 'string') changes.status = body.status as ChecklistStatus;
	if (changes.text === undefined && changes.status === undefined) {
		return context.json({ error: 'text or status is required' }, 400);
	}

	try {
		const entry = await updateChecklistEntry(projectId, itemNumber, entryId, changes);
		if (!entry) return context.json({ error: 'No such item or checklist entry' }, 404);
		return context.json(entry);
	} catch (error) {
		if (error instanceof ChecklistValidationError) return context.json({ error: error.message }, 400);
		console.error('Failed to update checklist entry:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

/** DELETE /items/:itemKey/checklist/:id — drop one entry. */
export async function handleDeleteChecklistEntry(context: Context): Promise<Response> {
	const { id: projectId } = requireResolvedProject(context);
	const itemNumber = pathItemNumber(context);
	if (typeof itemNumber !== 'number') return itemNumber;

	const entryId = context.req.param('id');
	if (!entryId) return context.json({ error: 'Invalid checklist entry ID' }, 400);

	try {
		const removed = await removeChecklistEntry(projectId, itemNumber, entryId);
		if (!removed) return context.json({ error: 'No such item or checklist entry' }, 404);
		return context.json({ success: true });
	} catch (error) {
		console.error('Failed to delete checklist entry:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
