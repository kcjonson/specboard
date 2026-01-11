/**
 * Progress notes service - shared business logic for progress notes
 */

import { query } from '../index.ts';
import type { ProgressNote } from '../types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Response types (camelCase for API/MCP responses)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProgressNoteResponse {
	id: string;
	epicId: string | null;
	taskId: string | null;
	note: string;
	createdBy: string;
	createdAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

function transformProgressNote(note: ProgressNote): ProgressNoteResponse {
	return {
		id: note.id,
		epicId: note.epic_id,
		taskId: note.task_id,
		note: note.note,
		createdBy: note.created_by,
		createdAt: note.created_at,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Service functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get progress notes for an epic
 */
export async function getEpicProgressNotes(epicId: string): Promise<ProgressNoteResponse[]> {
	const result = await query<ProgressNote>(
		'SELECT * FROM progress_notes WHERE epic_id = $1 ORDER BY created_at DESC',
		[epicId]
	);
	return result.rows.map(transformProgressNote);
}

/**
 * Get progress notes for a task
 */
export async function getTaskProgressNotes(taskId: string): Promise<ProgressNoteResponse[]> {
	const result = await query<ProgressNote>(
		'SELECT * FROM progress_notes WHERE task_id = $1 ORDER BY created_at DESC',
		[taskId]
	);
	return result.rows.map(transformProgressNote);
}

/**
 * Add a progress note to an epic
 */
export async function addEpicProgressNote(
	epicId: string,
	note: string,
	createdBy: string = 'system'
): Promise<ProgressNoteResponse> {
	// Verify epic exists
	const epicCheck = await query('SELECT id FROM epics WHERE id = $1', [epicId]);
	if (epicCheck.rows.length === 0) {
		throw new Error('Epic not found');
	}

	const result = await query<ProgressNote>(
		`INSERT INTO progress_notes (epic_id, note, created_by)
		 VALUES ($1, $2, $3)
		 RETURNING *`,
		[epicId, note, createdBy]
	);

	return transformProgressNote(result.rows[0]!);
}

/**
 * Add a progress note to a task
 */
export async function addTaskProgressNote(
	taskId: string,
	note: string,
	createdBy: string = 'system'
): Promise<ProgressNoteResponse> {
	// Verify task exists
	const taskCheck = await query('SELECT id FROM tasks WHERE id = $1', [taskId]);
	if (taskCheck.rows.length === 0) {
		throw new Error('Task not found');
	}

	const result = await query<ProgressNote>(
		`INSERT INTO progress_notes (task_id, note, created_by)
		 VALUES ($1, $2, $3)
		 RETURNING *`,
		[taskId, note, createdBy]
	);

	return transformProgressNote(result.rows[0]!);
}
