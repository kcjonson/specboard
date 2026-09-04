/**
 * Item note service — the append-only activity log on an item.
 *
 * Each row is one entry: text plus the Actor that wrote it, captured
 * server-side (NULL on rows backfilled by 027, which predate actor capture).
 * Entries are never edited or deleted; the log is the item's history.
 *
 * Appending an entry bumps the item's updated_at: the board's poll reconcile
 * skips items whose updatedAt is unchanged, so without the bump other sessions
 * (and agents polling get_items) would never see the new entry.
 *
 * Used by both API handlers and MCP tools.
 */

import { query, transaction } from '../index.ts';
import type { Actor, ItemNote } from '../types.ts';

// An absurd-size guard, not an editorial limit: entry text is agent-written prose
// and backfilled 027 rows are routinely long. This only stops a runaway write.
export const MAX_NOTE_LENGTH = 10000;

/** Thrown when note text is empty or over-long. */
export class NoteValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NoteValidationError';
	}
}

export interface ItemNoteSummary {
	id: string;
	note: string;
	/** Who wrote the entry; null predates actor capture. */
	actor: Actor | null;
	createdAt: Date;
}

function toSummary(row: ItemNote): ItemNoteSummary {
	return {
		id: row.id,
		note: row.note,
		actor: row.actor,
		createdAt: row.created_at,
	};
}

/** Trim and bounds-check entry text. The only place note text is validated. */
function validateNote(note: string): string {
	const text = note.trim();
	if (text.length === 0) throw new NoteValidationError('Note text must be a non-empty string');
	if (text.length > MAX_NOTE_LENGTH) {
		throw new NoteValidationError(`Note text must be at most ${MAX_NOTE_LENGTH} characters`);
	}
	return text;
}

/**
 * List an item's log entries, newest first.
 * Returns null if the item isn't in the project (a miss is a 404, not an empty log).
 */
export async function listItemNotes(projectId: string, itemNumber: number): Promise<ItemNoteSummary[] | null> {
	const item = await query<{ id: string }>(
		'SELECT id FROM items WHERE number = $1 AND project_id = $2',
		[itemNumber, projectId]
	);
	const itemId = item.rows[0]?.id;
	if (!itemId) return null;
	const result = await query<ItemNote>(
		`SELECT n.* FROM item_notes n
		 JOIN items i ON i.id = n.item_id
		 WHERE i.number = $1 AND i.project_id = $2
		 ORDER BY n.created_at DESC`,
		[itemNumber, projectId]
	);
	return result.rows.map(toSummary);
}

/**
 * Append one entry to an item's log. Returns null if the item isn't in the project;
 * throws NoteValidationError on empty or over-long text.
 */
export async function addItemNote(
	projectId: string,
	itemNumber: number,
	note: string,
	actor?: Actor
): Promise<ItemNoteSummary | null> {
	const text = validateNote(note);
	const row = await transaction(async (client) => {
		const inserted = await client.query<ItemNote>(
			`INSERT INTO item_notes (item_id, note, actor)
			 SELECT id, $3, $4 FROM items WHERE number = $1 AND project_id = $2
			 RETURNING *`,
			[itemNumber, projectId, text, actor ? JSON.stringify(actor) : null]
		);
		const noteRow = inserted.rows[0];
		if (!noteRow) return null;
		await client.query('UPDATE items SET updated_at = NOW() WHERE id = $1', [noteRow.item_id]);
		return noteRow;
	});
	return row ? toSummary(row) : null;
}

/**
 * Batch-load log entries for many items (item-response hydration), newest first.
 * No projectId: item_notes has no project_id column, and the ids come from an
 * already project-scoped query. Never call this with ids from anywhere else.
 */
export async function listNotesByItems(itemIds: string[]): Promise<Map<string, ItemNoteSummary[]>> {
	const result = await query<ItemNote>(
		'SELECT * FROM item_notes WHERE item_id = ANY($1) ORDER BY created_at DESC',
		[itemIds]
	);
	const byItem = new Map<string, ItemNoteSummary[]>();
	for (const row of result.rows) {
		const existing = byItem.get(row.item_id) || [];
		existing.push(toSummary(row));
		byItem.set(row.item_id, existing);
	}
	return byItem;
}
