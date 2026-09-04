/**
 * Item note handlers — the append-only activity log on an item.
 *
 * Entries are never edited or deleted, so this is a list and an append. The
 * actor is captured from the authenticated session; a client can't set it.
 */

import type { Context } from 'hono';
import { listItemNotes, addItemNote, NoteValidationError } from '@specboard/db';
import type { ResolvedProject } from '@specboard/db';
import { requireResolvedProject, apiActor } from './items.ts';
import { itemNumberInProject, parseItemKey } from '@specboard/core/identifiers';
import { apiNote } from '../types.ts';

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

export async function handleListItemNotes(context: Context): Promise<Response> {
	const project = requireResolvedProject(context);
	const number = itemNumber(context, project);
	if (typeof number !== 'number') return number;

	try {
		const notes = await listItemNotes(project.id, number);
		if (!notes) return context.json({ error: 'Item not found' }, 404);
		return context.json(notes.map(apiNote));
	} catch (error) {
		console.error('Failed to list item notes:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleAddItemNote(context: Context): Promise<Response> {
	const project = requireResolvedProject(context);
	const number = itemNumber(context, project);
	if (typeof number !== 'number') return number;

	const body = await context.req.json<{ note?: unknown }>();
	if (typeof body.note !== 'string') return context.json({ error: 'note is required' }, 400);

	try {
		const note = await addItemNote(project.id, number, body.note, apiActor(context));
		if (!note) return context.json({ error: 'Item not found' }, 404);
		return context.json(apiNote(note), 201);
	} catch (error) {
		if (error instanceof NoteValidationError) return context.json({ error: error.message }, 400);
		console.error('Failed to add item note:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
