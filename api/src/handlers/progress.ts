/**
 * Progress notes handlers — notes attached to items.
 */

import type { Context } from 'hono';
import { verifyItemOwnership, getItemProgressNotes, addItemProgressNote } from '@specboard/db';
import type { ResolvedProject } from '@specboard/db';
import { requireResolvedProject } from './items.ts';
import { itemNumberInProject, parseItemKey } from '@specboard/core/identifiers';

/**
 * The :itemKey path segment as a per-project number, or an error Response: a
 * malformed key is a 400, another project's key is a 404 like any other miss.
 */
function itemNumber(context: Context, project: ResolvedProject): number | Response {
	const key = context.req.param('itemKey');
	if (!key || !parseItemKey(key)) return context.json({ error: 'Invalid item key' }, 400);

	const number = itemNumberInProject(key, project.key);
	if (number === null) return context.json({ error: 'Item not found' }, 404);
	return number;
}

export async function handleListItemProgress(context: Context): Promise<Response> {
	const project = requireResolvedProject(context);
	const number = itemNumber(context, project);
	if (typeof number !== 'number') return number;

	try {
		if (!(await verifyItemOwnership(project.id, number))) {
			return context.json({ error: 'Item not found' }, 404);
		}
		const notes = await getItemProgressNotes(project.id, number);
		return context.json(notes);
	} catch (error) {
		console.error('Failed to fetch item progress notes:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleCreateItemProgress(context: Context): Promise<Response> {
	const project = requireResolvedProject(context);
	const number = itemNumber(context, project);
	if (typeof number !== 'number') return number;

	const body = await context.req.json<{ note?: string; createdBy?: string }>();
	if (!body.note || typeof body.note !== 'string' || body.note.trim() === '') {
		return context.json({ error: 'note is required' }, 400);
	}

	try {
		if (!(await verifyItemOwnership(project.id, number))) {
			return context.json({ error: 'Item not found' }, 404);
		}
		const note = await addItemProgressNote(project.id, number, body.note.trim(), body.createdBy ?? 'claude');
		return context.json(note, 201);
	} catch (error) {
		console.error('Failed to create item progress note:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
