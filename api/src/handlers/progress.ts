/**
 * Progress notes handlers — notes attached to items.
 */

import type { Context } from 'hono';
import { verifyItemOwnership, getItemProgressNotes, addItemProgressNote } from '@specboard/db';
import type { ResolvedProject } from '@specboard/db';
import { parseItemKey } from '@specboard/core/identifiers';

/** The :itemKey path segment as a per-project number, or null if it isn't this project's. */
function itemNumber(context: Context, project: ResolvedProject): number | null {
	const key = context.req.param('itemKey');
	const parsed = key ? parseItemKey(key) : null;
	if (!parsed || parsed.projectKey !== project.key) return null;
	return parsed.number;
}

export async function handleListItemProgress(context: Context): Promise<Response> {
	const project = context.get('project') as ResolvedProject;
	const number = itemNumber(context, project);
	if (number === null) return context.json({ error: 'Invalid item key' }, 400);

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
	const project = context.get('project') as ResolvedProject;
	const number = itemNumber(context, project);
	if (number === null) return context.json({ error: 'Invalid item key' }, 400);

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
