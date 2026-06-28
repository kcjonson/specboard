/**
 * Progress notes service — shared business logic for progress notes on items.
 */

import { query } from '../index.ts';
import type { ProgressNote } from '../types.ts';

export interface ProgressNoteResponse {
	id: string;
	itemId: string;
	note: string;
	createdBy: string;
	createdAt: Date;
}

function transformProgressNote(note: ProgressNote): ProgressNoteResponse {
	return {
		id: note.id,
		itemId: note.item_id,
		note: note.note,
		createdBy: note.created_by,
		createdAt: note.created_at,
	};
}

/** Get progress notes for an item, newest first. */
export async function getItemProgressNotes(itemId: string): Promise<ProgressNoteResponse[]> {
	const result = await query<ProgressNote>(
		'SELECT * FROM progress_notes WHERE item_id = $1 ORDER BY created_at DESC',
		[itemId]
	);
	return result.rows.map(transformProgressNote);
}

/** Add a progress note to an item. Throws if the item doesn't exist. */
export async function addItemProgressNote(
	itemId: string,
	note: string,
	createdBy: string = 'system'
): Promise<ProgressNoteResponse> {
	const itemCheck = await query('SELECT id FROM items WHERE id = $1', [itemId]);
	if (itemCheck.rows.length === 0) {
		throw new Error('Item not found');
	}

	const result = await query<ProgressNote>(
		`INSERT INTO progress_notes (item_id, note, created_by)
		 VALUES ($1, $2, $3)
		 RETURNING *`,
		[itemId, note, createdBy]
	);

	return transformProgressNote(result.rows[0]!);
}
