/**
 * Epic service - shared business logic for epics
 */

import { query } from '../index.ts';
import type { Epic, Task, ProgressNote, EpicStatus } from '../types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Response types (camelCase for API/MCP responses)
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskStats {
	total: number;
	done: number;
	inProgress: number;
	blocked: number;
}

export interface EpicSummary {
	id: string;
	title: string;
	description: string | null;
	specDocPath: string | null;
	createdAt: Date;
}

export interface TaskSummary {
	id: string;
	title: string;
	status: string;
	details: string | null;
	blockReason: string | null;
}

export interface ProgressNoteSummary {
	id: string;
	note: string;
	createdBy: string;
	createdAt: Date;
}

export interface EpicResponse {
	id: string;
	title: string;
	description: string | null;
	status: EpicStatus;
	creator: string | null;
	rank: number;
	specDocPath: string | null;
	prUrl: string | null;
	createdAt: Date;
	updatedAt: Date;
	taskStats: TaskStats;
}

export interface EpicWithTasks extends EpicResponse {
	tasks: TaskSummary[];
}

export interface EpicWithDetails extends EpicWithTasks {
	progressNotes: ProgressNoteSummary[];
}

export interface CurrentWorkEpic {
	id: string;
	title: string;
	status: EpicStatus;
	specDocPath: string | null;
	taskStats: TaskStats;
	currentTask: TaskSummary | null;
	recentNotes: Array<{ note: string; createdAt: Date }>;
}

export interface CurrentWorkResponse {
	inProgressEpics: CurrentWorkEpic[];
	readyEpics: EpicSummary[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

function transformEpic(epic: Epic): Omit<EpicResponse, 'taskStats'> {
	return {
		id: epic.id,
		title: epic.title,
		description: epic.description,
		status: epic.status,
		creator: epic.creator,
		rank: epic.rank,
		specDocPath: epic.spec_doc_path,
		prUrl: epic.pr_url,
		createdAt: epic.created_at,
		updatedAt: epic.updated_at,
	};
}

function transformTask(task: Task): TaskSummary {
	return {
		id: task.id,
		title: task.title,
		status: task.status,
		details: task.details,
		blockReason: task.block_reason,
	};
}

function transformProgressNote(note: ProgressNote): ProgressNoteSummary {
	return {
		id: note.id,
		note: note.note,
		createdBy: note.created_by,
		createdAt: note.created_at,
	};
}

function calculateTaskStats(tasks: Task[]): TaskStats {
	return {
		total: tasks.length,
		done: tasks.filter((t) => t.status === 'done').length,
		inProgress: tasks.filter((t) => t.status === 'in_progress').length,
		blocked: tasks.filter((t) => t.status === 'blocked').length,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Service functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get all epics for a project, optionally filtered by status
 */
export async function getEpics(projectId: string, status?: EpicStatus): Promise<EpicResponse[]> {
	let sql = `
		SELECT e.*,
			COUNT(t.id) as task_count,
			COUNT(t.id) FILTER (WHERE t.status = 'done') as done_count
		FROM epics e
		LEFT JOIN tasks t ON t.epic_id = e.id
		WHERE e.project_id = $1
	`;
	const params: unknown[] = [projectId];

	if (status) {
		sql += ` AND e.status = $2`;
		params.push(status);
	}

	sql += ` GROUP BY e.id ORDER BY e.rank ASC`;

	const result = await query<Epic & { task_count: string; done_count: string }>(sql, params);

	return result.rows.map((row) => ({
		...transformEpic(row),
		taskStats: {
			total: parseInt(row.task_count, 10),
			done: parseInt(row.done_count, 10),
			inProgress: 0, // Not fetched in list view for performance
			blocked: 0,
		},
	}));
}

/**
 * Get ready epics (available for work)
 */
export async function getReadyEpics(projectId: string): Promise<EpicSummary[]> {
	const result = await query<Epic>(
		`SELECT id, title, description, spec_doc_path, created_at
		 FROM epics
		 WHERE project_id = $1 AND status = 'ready'
		 ORDER BY rank ASC`,
		[projectId]
	);

	return result.rows.map((epic) => ({
		id: epic.id,
		title: epic.title,
		description: epic.description,
		specDocPath: epic.spec_doc_path,
		createdAt: epic.created_at,
	}));
}

/**
 * Get a single epic by ID
 */
export async function getEpic(projectId: string, epicId: string): Promise<EpicWithTasks | null> {
	const epicResult = await query<Epic>(
		'SELECT * FROM epics WHERE id = $1 AND project_id = $2',
		[epicId, projectId]
	);

	if (epicResult.rows.length === 0) {
		return null;
	}

	const epic = epicResult.rows[0]!;

	const tasksResult = await query<Task>(
		'SELECT * FROM tasks WHERE epic_id = $1 ORDER BY rank ASC',
		[epicId]
	);

	const tasks = tasksResult.rows;

	return {
		...transformEpic(epic),
		taskStats: calculateTaskStats(tasks),
		tasks: tasks.map(transformTask),
	};
}

/**
 * Get epic with full details including progress notes
 */
export async function getEpicWithDetails(
	projectId: string,
	epicId: string
): Promise<EpicWithDetails | null> {
	const epic = await getEpic(projectId, epicId);
	if (!epic) return null;

	const notesResult = await query<ProgressNote>(
		'SELECT * FROM progress_notes WHERE epic_id = $1 ORDER BY created_at DESC LIMIT 20',
		[epicId]
	);

	return {
		...epic,
		progressNotes: notesResult.rows.map(transformProgressNote),
	};
}

/**
 * Get current work - in-progress and in-review epics with context
 */
export async function getCurrentWork(projectId: string): Promise<CurrentWorkResponse> {
	// Get in-progress and in-review epics
	const epicsResult = await query<Epic>(
		`SELECT * FROM epics
		 WHERE project_id = $1 AND status IN ('in_progress', 'in_review')
		 ORDER BY updated_at DESC`,
		[projectId]
	);

	// Get ready epics for context
	const readyResult = await query<Epic>(
		`SELECT id, title, description, spec_doc_path, created_at
		 FROM epics
		 WHERE project_id = $1 AND status = 'ready'
		 ORDER BY rank ASC
		 LIMIT 5`,
		[projectId]
	);

	// Build response with task details for in-progress epics
	const inProgressEpics = await Promise.all(
		epicsResult.rows.map(async (epic) => {
			const tasksResult = await query<Task>(
				'SELECT * FROM tasks WHERE epic_id = $1 ORDER BY rank ASC',
				[epic.id]
			);

			const notesResult = await query<ProgressNote>(
				'SELECT note, created_at FROM progress_notes WHERE epic_id = $1 ORDER BY created_at DESC LIMIT 5',
				[epic.id]
			);

			const tasks = tasksResult.rows;
			const currentTask = tasks.find((t) => t.status === 'in_progress');

			return {
				id: epic.id,
				title: epic.title,
				status: epic.status,
				specDocPath: epic.spec_doc_path,
				taskStats: calculateTaskStats(tasks),
				currentTask: currentTask ? transformTask(currentTask) : null,
				recentNotes: notesResult.rows.map((n) => ({
					note: n.note,
					createdAt: n.created_at,
				})),
			};
		})
	);

	return {
		inProgressEpics,
		readyEpics: readyResult.rows.map((e) => ({
			id: e.id,
			title: e.title,
			description: e.description,
			specDocPath: e.spec_doc_path,
			createdAt: e.created_at,
		})),
	};
}

/**
 * Create a new epic
 */
export interface CreateEpicInput {
	title: string;
	description?: string;
	status?: EpicStatus;
	creator?: string;
	rank?: number;
	specDocPath?: string;
}

export async function createEpic(
	projectId: string,
	data: CreateEpicInput
): Promise<EpicResponse> {
	// Get next rank if not provided
	let rank = data.rank;
	if (rank === undefined) {
		const rankResult = await query<{ max: number }>(
			'SELECT COALESCE(MAX(rank), 0) as max FROM epics WHERE project_id = $1',
			[projectId]
		);
		rank = (rankResult.rows[0]?.max ?? 0) + 1;
	}

	const result = await query<Epic>(
		`INSERT INTO epics (project_id, title, description, status, creator, rank, spec_doc_path)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING *`,
		[
			projectId,
			data.title,
			data.description || null,
			data.status || 'ready',
			data.creator || null,
			rank,
			data.specDocPath || null,
		]
	);

	const epic = result.rows[0]!;
	return {
		...transformEpic(epic),
		taskStats: { total: 0, done: 0, inProgress: 0, blocked: 0 },
	};
}

/**
 * Update an epic
 */
export interface UpdateEpicInput {
	title?: string;
	description?: string;
	status?: EpicStatus;
	rank?: number;
	specDocPath?: string;
	prUrl?: string;
}

export async function updateEpic(
	projectId: string,
	epicId: string,
	data: UpdateEpicInput
): Promise<EpicResponse | null> {
	const updates: string[] = [];
	const values: unknown[] = [];
	let paramIndex = 1;

	if (data.title !== undefined) {
		updates.push(`title = $${paramIndex++}`);
		values.push(data.title);
	}
	if (data.description !== undefined) {
		updates.push(`description = $${paramIndex++}`);
		values.push(data.description);
	}
	if (data.status !== undefined) {
		updates.push(`status = $${paramIndex++}`);
		values.push(data.status);
	}
	if (data.rank !== undefined) {
		updates.push(`rank = $${paramIndex++}`);
		values.push(data.rank);
	}
	if (data.specDocPath !== undefined) {
		updates.push(`spec_doc_path = $${paramIndex++}`);
		values.push(data.specDocPath);
	}
	if (data.prUrl !== undefined) {
		updates.push(`pr_url = $${paramIndex++}`);
		values.push(data.prUrl);
	}

	if (updates.length === 0) {
		return getEpic(projectId, epicId);
	}

	updates.push('updated_at = NOW()');
	values.push(epicId, projectId);

	const result = await query<Epic>(
		`UPDATE epics SET ${updates.join(', ')}
		 WHERE id = $${paramIndex++} AND project_id = $${paramIndex}
		 RETURNING *`,
		values
	);

	if (result.rows.length === 0) {
		return null;
	}

	const epic = result.rows[0]!;

	// Get task stats
	const tasksResult = await query<Task>(
		'SELECT status FROM tasks WHERE epic_id = $1',
		[epicId]
	);

	return {
		...transformEpic(epic),
		taskStats: calculateTaskStats(tasksResult.rows),
	};
}

/**
 * Delete an epic
 */
export async function deleteEpic(projectId: string, epicId: string): Promise<boolean> {
	const result = await query(
		'DELETE FROM epics WHERE id = $1 AND project_id = $2',
		[epicId, projectId]
	);
	return (result.rowCount ?? 0) > 0;
}

/**
 * Signal epic is ready for review (set status and PR URL)
 */
export async function signalReadyForReview(
	projectId: string,
	epicId: string,
	prUrl: string
): Promise<EpicResponse | null> {
	return updateEpic(projectId, epicId, { status: 'in_review', prUrl });
}
