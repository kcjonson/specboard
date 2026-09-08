/**
 * Checklist service — ordered scratch todos on an item (items.checklist).
 *
 * An entry is {id, text, status} and nothing more: no actor, no timestamps, no
 * lifecycle. A step that wants any of those is a child item, which carries a
 * key, a board status, blockers, and an activity log. Array order is display
 * order, so a reorder is a rewrite of the array.
 *
 * Entry-level writes rewrite ONLY the element they matched, in one statement:
 * a UI ticking entry A must not lose a concurrent rename of entry B, which a
 * read-modify-write of the whole array would do. setChecklist is the deliberate
 * exception — it is the full replace, and the caller means to own the array.
 *
 * Used by both API handlers and MCP tools.
 */

import { randomUUID } from 'node:crypto';
import { query } from '../index.ts';
import type { ChecklistEntry, ChecklistStatus } from '../types.ts';
import { verifyItemOwnership } from './items.ts';

/** One entry as a caller may supply it: id optional (minted when absent), status defaulting to 'todo'. */
export interface ChecklistEntryInput {
	id?: string;
	text: string;
	status?: ChecklistStatus;
}

export const MAX_CHECKLIST_ENTRIES = 100;
export const MAX_CHECKLIST_TEXT = 500;
/** The states an entry may hold. The service owns this set, not a DB constraint. */
export const CHECKLIST_STATUSES: readonly ChecklistStatus[] = ['todo', 'done'];

/** Thrown when checklist input is malformed (not an array, bad text, too many entries). */
export class ChecklistValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ChecklistValidationError';
	}
}

/** An item's checklist, or null if the item doesn't exist in the project. */
export async function getChecklist(projectId: string, itemNumber: number): Promise<ChecklistEntry[] | null> {
	const result = await query<{ checklist: ChecklistEntry[] }>(
		'SELECT checklist FROM items WHERE number = $1 AND project_id = $2',
		[itemNumber, projectId]
	);
	return result.rows[0]?.checklist ?? null;
}

/**
 * Replace the whole checklist. Ids are minted here for entries that lack one and
 * PRESERVED for entries that carry one, so an MCP round-trip doesn't invalidate
 * the ids a browser is holding. Returns null if the item doesn't exist.
 */
export async function setChecklist(
	projectId: string,
	itemNumber: number,
	entries: ChecklistEntryInput[]
): Promise<ChecklistEntry[] | null> {
	const validated = validateEntries(entries);
	const result = await query<{ checklist: ChecklistEntry[] }>(
		`UPDATE items SET checklist = $3::jsonb
		 WHERE number = $1 AND project_id = $2
		 RETURNING checklist`,
		[itemNumber, projectId, JSON.stringify(validated)]
	);
	return result.rows[0]?.checklist ?? null;
}

/**
 * Append one entry. The cap lives in the WHERE clause rather than a prior SELECT
 * so it still holds when two appends race. Returns null if the item doesn't exist.
 */
export async function addChecklistEntry(
	projectId: string,
	itemNumber: number,
	text: string
): Promise<ChecklistEntry | null> {
	const cleaned = validateText(text);
	const result = await query<{ entry: ChecklistEntry }>(
		`UPDATE items
		 SET checklist = checklist || jsonb_build_array(
		         jsonb_build_object('id', gen_random_uuid()::text, 'text', $3::text, 'status', 'todo'))
		 WHERE number = $1 AND project_id = $2
		   AND jsonb_array_length(checklist) < $4
		 RETURNING checklist -> -1 AS entry`,
		[itemNumber, projectId, cleaned, MAX_CHECKLIST_ENTRIES]
	);
	const entry = result.rows[0]?.entry;
	if (entry) return entry;

	// Zero rows means either no such item or a full list. Both are rare, so one
	// extra query on the failure path beats carrying the distinction through the
	// statement above.
	if (!(await verifyItemOwnership(projectId, itemNumber))) return null;
	throw new ChecklistValidationError(`A checklist holds at most ${MAX_CHECKLIST_ENTRIES} entries`);
}

/**
 * Patch one entry's text and/or status. Returns null when the item or the entry
 * doesn't exist.
 *
 * The `@>` guard reads the OLD row (the entry must have existed before the
 * write), while RETURNING sees the NEW one — so the guard decides whether the
 * update happens and the RETURNING reports what it produced.
 */
export async function updateChecklistEntry(
	projectId: string,
	itemNumber: number,
	entryId: string,
	changes: { text?: string; status?: ChecklistStatus }
): Promise<ChecklistEntry | null> {
	const patch: Partial<ChecklistEntry> = {};
	if (changes.text !== undefined) patch.text = validateText(changes.text);
	if (changes.status !== undefined) patch.status = validateStatus(changes.status);

	const result = await query<{ entry: ChecklistEntry }>(
		`UPDATE items
		 SET checklist = (
		       SELECT COALESCE(jsonb_agg(
		                CASE WHEN e->>'id' = $3 THEN e || $4::jsonb ELSE e END
		                ORDER BY ord), '[]'::jsonb)
		       FROM jsonb_array_elements(checklist) WITH ORDINALITY AS t(e, ord))
		 WHERE number = $1 AND project_id = $2
		   AND checklist @> jsonb_build_array(jsonb_build_object('id', $3::text))
		 RETURNING (SELECT e FROM jsonb_array_elements(checklist) AS e WHERE e->>'id' = $3) AS entry`,
		[itemNumber, projectId, entryId, JSON.stringify(patch)]
	);
	return result.rows[0]?.entry ?? null;
}

/** Drop one entry. Returns true when a matching entry was removed. */
export async function removeChecklistEntry(
	projectId: string,
	itemNumber: number,
	entryId: string
): Promise<boolean> {
	const result = await query<{ id: string }>(
		`UPDATE items
		 SET checklist = (
		       SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb)
		       FROM jsonb_array_elements(checklist) WITH ORDINALITY AS t(e, ord)
		       WHERE e->>'id' <> $3)
		 WHERE number = $1 AND project_id = $2
		   AND checklist @> jsonb_build_array(jsonb_build_object('id', $3::text))
		 RETURNING id`,
		[itemNumber, projectId, entryId]
	);
	return result.rows.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

function validateText(text: unknown): string {
	if (typeof text !== 'string' || text.trim().length === 0) {
		throw new ChecklistValidationError('Checklist text must be a non-empty string');
	}
	const trimmed = text.trim();
	if (trimmed.length > MAX_CHECKLIST_TEXT) {
		throw new ChecklistValidationError(`Checklist text must be at most ${MAX_CHECKLIST_TEXT} characters`);
	}
	return trimmed;
}

function validateStatus(status: unknown): ChecklistStatus {
	if (!CHECKLIST_STATUSES.includes(status as ChecklistStatus)) {
		throw new ChecklistValidationError(`Checklist status must be one of: ${CHECKLIST_STATUSES.join(', ')}`);
	}
	return status as ChecklistStatus;
}

function validateEntries(entries: ChecklistEntryInput[]): ChecklistEntry[] {
	if (!Array.isArray(entries)) {
		throw new ChecklistValidationError('A checklist must be an array of entries');
	}
	if (entries.length > MAX_CHECKLIST_ENTRIES) {
		throw new ChecklistValidationError(`A checklist holds at most ${MAX_CHECKLIST_ENTRIES} entries`);
	}
	const seen = new Set<string>();
	return entries.map((raw) => {
		// A caller can send anything; without this a null or a bare string reaches
		// entry.text as a TypeError, which escapes ChecklistValidationError and
		// surfaces as a 500 instead of a 400.
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
			throw new ChecklistValidationError('Each checklist entry must be an object with text');
		}
		const entry = raw as ChecklistEntryInput;
		const id = typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : randomUUID();
		// Two entries sharing an id make every entry-level statement ambiguous: the
		// patch and remove guards match both, and the RETURNING subquery selects one
		// row by id and errors outright on two.
		if (seen.has(id)) {
			throw new ChecklistValidationError(`Duplicate checklist entry id ${id}`);
		}
		seen.add(id);
		return {
			id,
			text: validateText(entry.text),
			status: entry.status === undefined ? ('todo' as ChecklistStatus) : validateStatus(entry.status),
		};
	});
}
