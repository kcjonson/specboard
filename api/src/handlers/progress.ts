/**
 * Progress notes handlers — notes attached to items.
 */

import type { Context } from 'hono';
import { verifyItemOwnership, getItemProgressNotes, addItemProgressNote } from '@specboard/db';
import { isValidUUID } from '../validation.ts';

export async function handleListItemProgress(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const itemId = context.req.param('itemId');
	if (!isValidUUID(projectId) || !isValidUUID(itemId)) {
		return context.json({ error: 'Invalid ID format' }, 400);
	}

	try {
		if (!(await verifyItemOwnership(projectId, itemId))) {
			return context.json({ error: 'Item not found' }, 404);
		}
		const notes = await getItemProgressNotes(itemId);
		return context.json(notes);
	} catch (error) {
		console.error('Failed to fetch item progress notes:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleCreateItemProgress(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const itemId = context.req.param('itemId');
	if (!isValidUUID(projectId) || !isValidUUID(itemId)) {
		return context.json({ error: 'Invalid ID format' }, 400);
	}

	const body = await context.req.json<{ note?: string; createdBy?: string }>();
	if (!body.note || typeof body.note !== 'string' || body.note.trim() === '') {
		return context.json({ error: 'note is required' }, 400);
	}

	try {
		if (!(await verifyItemOwnership(projectId, itemId))) {
			return context.json({ error: 'Item not found' }, 404);
		}
		const note = await addItemProgressNote(itemId, body.note.trim(), body.createdBy ?? 'claude');
		return context.json(note, 201);
	} catch (error) {
		console.error('Failed to create item progress note:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
