/**
 * Epic service read operations
 */

import { query } from '../../index.ts';
import type { Epic, Task, ProgressNote, EpicStatus, EpicType } from '../../types.ts';
import type {
	EpicWithDetails,
} from './types.ts';
import { transformEpic, transformTask, transformProgressNote } from './transforms.ts';

export interface GetItemsParams {
	projectId: string;
	itemId?: string;
	status?: EpicStatus;
	type?: EpicType;
	search?: string;
	includeTasks?: boolean;
	includeNotes?: boolean;
	limit?: number;
}

/**
 * Flexible item query with filtering, search, and optional includes.
 * Replaces getReadyEpics, getEpic, getEpicWithDetails, getCurrentWork.
 *
 * Always returns task stats. Optionally includes full task lists and progress notes.
 * Uses batch fetching (ANY) to avoid N+1 queries.
 */
export async function getItems(params: GetItemsParams): Promise<EpicWithDetails[]> {
	const { projectId, itemId, status, type, search, includeTasks, includeNotes, limit = 25 } = params;

	// Build dynamic query with aggregated task stats
	let sql = `
		SELECT e.*,
			COUNT(t.id) as task_count,
			COUNT(t.id) FILTER (WHERE t.status = 'done') as done_count,
			COUNT(t.id) FILTER (WHERE t.status = 'in_progress') as in_progress_count,
			COUNT(t.id) FILTER (WHERE t.status = 'blocked') as blocked_count
		FROM epics e
		LEFT JOIN tasks t ON t.epic_id = e.id
		WHERE e.project_id = $1
	`;
	const queryParams: unknown[] = [projectId];
	let paramIndex = 2;

	if (itemId) {
		// Single-item lookup — skip other filters and limit
		sql += ` AND e.id = $${paramIndex}`;
		queryParams.push(itemId);
		paramIndex++;
	} else {
		if (status) {
			sql += ` AND e.status = $${paramIndex}`;
			queryParams.push(status);
			paramIndex++;
		}

		if (type) {
			sql += ` AND e.type = $${paramIndex}`;
			queryParams.push(type);
			paramIndex++;
		}

		if (search) {
			sql += ` AND (e.title ILIKE $${paramIndex} OR e.description ILIKE $${paramIndex})`;
			queryParams.push(`%${search}%`);
			paramIndex++;
		}
	}

	sql += ` GROUP BY e.id ORDER BY e.rank ASC`;

	if (!itemId) {
		sql += ` LIMIT $${paramIndex}`;
		queryParams.push(limit);
	}

	type EpicWithCounts = Epic & { task_count: string; done_count: string; in_progress_count: string; blocked_count: string };
	const result = await query<EpicWithCounts>(sql, queryParams);

	const epicIds = result.rows.map((r) => r.id);

	// Batch fetch tasks if requested
	const tasksByEpicId = new Map<string, Task[]>();
	if (includeTasks && epicIds.length > 0) {
		const tasksResult = await query<Task>(
			'SELECT * FROM tasks WHERE epic_id = ANY($1) ORDER BY rank ASC',
			[epicIds]
		);
		for (const task of tasksResult.rows) {
			const existing = tasksByEpicId.get(task.epic_id) || [];
			existing.push(task);
			tasksByEpicId.set(task.epic_id, existing);
		}
	}

	// Batch fetch progress notes if requested
	const notesByEpicId = new Map<string, ProgressNote[]>();
	if (includeNotes && epicIds.length > 0) {
		const notesResult = await query<ProgressNote>(
			'SELECT * FROM progress_notes WHERE epic_id = ANY($1) ORDER BY created_at DESC',
			[epicIds]
		);
		for (const note of notesResult.rows) {
			if (!note.epic_id) continue;
			const existing = notesByEpicId.get(note.epic_id) || [];
			existing.push(note);
			notesByEpicId.set(note.epic_id, existing);
		}
	}

	return result.rows.map((row) => ({
		...transformEpic(row),
		taskStats: {
			total: parseInt(row.task_count, 10),
			done: parseInt(row.done_count, 10),
			inProgress: parseInt(row.in_progress_count, 10),
			blocked: parseInt(row.blocked_count, 10),
		},
		tasks: (tasksByEpicId.get(row.id) || []).map(transformTask),
		progressNotes: (notesByEpicId.get(row.id) || []).map(transformProgressNote),
	}));
}
