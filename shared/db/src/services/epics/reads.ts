/**
 * Epic service read operations
 */

import { query } from '../../index.ts';
import type { Epic, Task, ProgressNote, EpicStatus, EpicType } from '../../types.ts';
import type {
	EpicResponse,
	EpicSummary,
	EpicWithTasks,
	EpicWithDetails,
	CurrentWorkResponse,
} from './types.ts';
import { transformEpic, transformTask, transformProgressNote, calculateTaskStats } from './transforms.ts';

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
 * Get ready epics (available for work), optionally filtered by type
 */
export async function getReadyEpics(projectId: string, type?: EpicType): Promise<EpicSummary[]> {
	let sql = `SELECT id, title, type, description, spec_doc_path, created_at
		 FROM epics
		 WHERE project_id = $1 AND status = 'ready'`;
	const params: unknown[] = [projectId];

	if (type) {
		sql += ` AND type = $2`;
		params.push(type);
	}

	sql += ` ORDER BY rank ASC`;

	const result = await query<Epic>(sql, params);

	return result.rows.map((epic) => ({
		id: epic.id,
		title: epic.title,
		type: epic.type,
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
		`SELECT id, title, type, description, spec_doc_path, created_at
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
				type: epic.type,
				status: epic.status,
				subStatus: epic.sub_status,
				specDocPath: epic.spec_doc_path,
				prUrl: epic.pr_url,
				branchName: epic.branch_name,
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
			type: e.type,
			description: e.description,
			specDocPath: e.spec_doc_path,
			createdAt: e.created_at,
		})),
	};
}
