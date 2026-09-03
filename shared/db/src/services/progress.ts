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
export async function getItemProgressNotes(projectId: string, itemNumber: number): Promise<ProgressNoteResponse[]> {
	const result = await query<ProgressNote>(
		`SELECT n.* FROM progress_notes n
		 JOIN items i ON i.id = n.item_id
		 WHERE i.number = $1 AND i.project_id = $2
		 ORDER BY n.created_at DESC`,
		[itemNumber, projectId]
	);
	return result.rows.map(transformProgressNote);
}

/** Add a progress note to an item. Throws if the item doesn't exist in the project. */
export async function addItemProgressNote(
	projectId: string,
	itemNumber: number,
	note: string,
	createdBy: string = 'system'
): Promise<ProgressNoteResponse> {
	const itemCheck = await query<{ id: string }>(
		'SELECT id FROM items WHERE number = $1 AND project_id = $2',
		[itemNumber, projectId]
	);
	const itemId = itemCheck.rows[0]?.id;
	if (!itemId) {
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
