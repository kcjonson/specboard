/**
 * Epic handlers
 */

import type { Context } from 'hono';
import { query, type Epic as DbEpic, type Task as DbTask, type ProgressNote as DbProgressNote } from '@specboard/db';
import type { ApiEpic, TaskStats } from '../types.ts';
import { dbEpicToApi, dbTaskToApi, dbProgressNoteToApi } from '../transform.ts';
import {
	isValidUUID,
	isValidOptionalUUID,
	isValidStatus,
	isValidTitle,
	normalizeOptionalString,
	MAX_TITLE_LENGTH,
} from '../validation.ts';

export async function handleListEpics(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	try {
		const statusParam = context.req.query('status');
		const specDocPath = context.req.query('specDocPath');
		const validStatuses = ['ready', 'in_progress', 'in_review', 'done'];

		let result;
		if (specDocPath) {
			// Filter by spec document path
			result = await query<DbEpic>(
				`SELECT * FROM epics WHERE project_id = $1 AND spec_doc_path = $2 ORDER BY rank ASC`,
				[projectId, specDocPath]
			);
		} else if (statusParam && validStatuses.includes(statusParam)) {
			result = await query<DbEpic>(
				`SELECT * FROM epics WHERE project_id = $1 AND status = $2 ORDER BY rank ASC`,
				[projectId, statusParam]
			);
		} else {
			result = await query<DbEpic>(
				`SELECT * FROM epics WHERE project_id = $1 ORDER BY rank ASC`,
				[projectId]
			);
		}

		const epicIds = result.rows.map((e) => e.id);
		let statsMap = new Map<string, { total: number; done: number }>();

		if (epicIds.length > 0) {
			const statsResult = await query<{ epic_id: string; total: string; done: string }>(`
				SELECT
					epic_id,
					COUNT(*)::text as total,
					COUNT(*) FILTER (WHERE status = 'done')::text as done
				FROM tasks
				WHERE epic_id = ANY($1)
				GROUP BY epic_id
			`, [epicIds]);

			statsMap = new Map(
				statsResult.rows.map((row) => [
					row.epic_id,
					{ total: parseInt(row.total, 10), done: parseInt(row.done, 10) },
				])
			);
		}

		const epicList = result.rows.map((epic) => ({
			...dbEpicToApi(epic),
			taskStats: statsMap.get(epic.id) || { total: 0, done: 0 },
		}));

		return context.json(epicList);
	} catch (error) {
		console.error('Failed to fetch epics:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleGetEpic(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const id = context.req.param('id');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid epic ID format' }, 400);
	}

	try {
		const epicResult = await query<DbEpic>(
			`SELECT * FROM epics WHERE id = $1 AND project_id = $2`,
			[id, projectId]
		);
		if (epicResult.rows.length === 0) {
			return context.json({ error: 'Epic not found' }, 404);
		}

		const epic = epicResult.rows[0];
		if (!epic) {
			return context.json({ error: 'Epic not found' }, 404);
		}

		const tasksResult = await query<DbTask>(
			`SELECT * FROM tasks WHERE epic_id = $1 ORDER BY rank ASC`,
			[id]
		);

		const tasks = tasksResult.rows.map(dbTaskToApi);
		const taskStats: TaskStats = {
			total: tasks.length,
			done: tasks.filter((task) => task.status === 'done').length,
		};

		return context.json({
			...dbEpicToApi(epic),
			tasks,
			taskStats,
		});
	} catch (error) {
		console.error('Failed to fetch epic:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleCreateEpic(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	const body = await context.req.json<Partial<ApiEpic>>();
	const status = body.status || 'ready';
	const title = body.title || 'Untitled Epic';

	if (body.status !== undefined && !isValidStatus(body.status)) {
		return context.json({ error: 'Invalid status. Must be one of: ready, in_progress, done' }, 400);
	}

	if (!isValidTitle(title)) {
		return context.json({ error: `Title must be between 1 and ${MAX_TITLE_LENGTH} characters` }, 400);
	}

	if (!isValidOptionalUUID(body.creator)) {
		return context.json({ error: 'Invalid creator. Must be a valid UUID' }, 400);
	}

	if (!isValidOptionalUUID(body.assignee)) {
		return context.json({ error: 'Invalid assignee. Must be a valid UUID' }, 400);
	}

	try {
		// New epics go to the top of the column (lowest rank)
		// Use a high default initial rank to avoid starting at 0 and going negative
		const DEFAULT_INITIAL_RANK = 1000;
		const rankResult = await query<{ min_rank: number | null }>(
			`SELECT MIN(rank) as min_rank FROM epics WHERE project_id = $1 AND status = $2`,
			[projectId, status]
		);
		const minRank = rankResult.rows[0]?.min_rank ?? DEFAULT_INITIAL_RANK;
		const newRank = minRank - 1;

		const result = await query<DbEpic>(
			`INSERT INTO epics (project_id, title, description, status, creator, assignee, rank, spec_doc_path)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			 RETURNING *`,
			[
				projectId,
				title,
				normalizeOptionalString(body.description) ?? null,
				status,
				normalizeOptionalString(body.creator) ?? null,
				normalizeOptionalString(body.assignee) ?? null,
				newRank,
				normalizeOptionalString(body.specDocPath) ?? null,
			]
		);

		const epic = result.rows[0];
		if (!epic) {
			return context.json({ error: 'Failed to create epic' }, 500);
		}

		return context.json(dbEpicToApi(epic), 201);
	} catch (error) {
		console.error('Failed to create epic:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleUpdateEpic(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const id = context.req.param('id');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid epic ID format' }, 400);
	}

	const body = await context.req.json<Partial<ApiEpic>>();

	if (body.status !== undefined && !isValidStatus(body.status)) {
		return context.json({ error: 'Invalid status. Must be one of: ready, in_progress, done' }, 400);
	}

	if (body.title !== undefined && !isValidTitle(body.title)) {
		return context.json({ error: `Title must be between 1 and ${MAX_TITLE_LENGTH} characters` }, 400);
	}

	if (!isValidOptionalUUID(body.creator)) {
		return context.json({ error: 'Invalid creator. Must be a valid UUID' }, 400);
	}

	if (!isValidOptionalUUID(body.assignee)) {
		return context.json({ error: 'Invalid assignee. Must be a valid UUID' }, 400);
	}

	try {
		const updates: string[] = [];
		const values: unknown[] = [];
		let paramIndex = 1;

		if (body.title !== undefined) {
			updates.push(`title = $${paramIndex++}`);
			values.push(body.title);
		}
		if (body.description !== undefined) {
			updates.push(`description = $${paramIndex++}`);
			const normalized = normalizeOptionalString(body.description);
			values.push(normalized === undefined ? null : normalized);
		}
		if (body.status !== undefined) {
			updates.push(`status = $${paramIndex++}`);
			values.push(body.status);
		}
		if (body.creator !== undefined) {
			updates.push(`creator = $${paramIndex++}`);
			const normalized = normalizeOptionalString(body.creator);
			values.push(normalized === undefined ? null : normalized);
		}
		if (body.assignee !== undefined) {
			updates.push(`assignee = $${paramIndex++}`);
			const normalized = normalizeOptionalString(body.assignee);
			values.push(normalized === undefined ? null : normalized);
		}
		if (body.rank !== undefined) {
			updates.push(`rank = $${paramIndex++}`);
			values.push(body.rank);
		}
		if (body.specDocPath !== undefined) {
			updates.push(`spec_doc_path = $${paramIndex++}`);
			const normalized = normalizeOptionalString(body.specDocPath);
			values.push(normalized === undefined ? null : normalized);
		}

		if (updates.length === 0) {
			const result = await query<DbEpic>(
				`SELECT * FROM epics WHERE id = $1 AND project_id = $2`,
				[id, projectId]
			);
			if (result.rows.length === 0) {
				return context.json({ error: 'Epic not found' }, 404);
			}
			const epic = result.rows[0];
			if (!epic) {
				return context.json({ error: 'Epic not found' }, 404);
			}
			return context.json(dbEpicToApi(epic));
		}

		values.push(id);
		values.push(projectId);

		const result = await query<DbEpic>(
			`UPDATE epics SET ${updates.join(', ')} WHERE id = $${paramIndex} AND project_id = $${paramIndex + 1} RETURNING *`,
			values
		);

		if (result.rows.length === 0) {
			return context.json({ error: 'Epic not found' }, 404);
		}

		const epic = result.rows[0];
		if (!epic) {
			return context.json({ error: 'Failed to update epic' }, 500);
		}

		return context.json(dbEpicToApi(epic));
	} catch (error) {
		console.error('Failed to update epic:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleDeleteEpic(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const id = context.req.param('id');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid epic ID format' }, 400);
	}

	try {
		const result = await query<{ id: string }>(
			`DELETE FROM epics WHERE id = $1 AND project_id = $2 RETURNING id`,
			[id, projectId]
		);

		if (result.rows.length === 0) {
			return context.json({ error: 'Epic not found' }, 404);
		}

		return context.json({ success: true });
	} catch (error) {
		console.error('Failed to delete epic:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleGetCurrentWork(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	try {
		// Get in-progress and in-review epics for this project
		const activeResult = await query<DbEpic>(
			`SELECT * FROM epics WHERE project_id = $1 AND status IN ('in_progress', 'in_review') ORDER BY rank ASC`,
			[projectId]
		);

		// Get ready epics for reference
		const readyResult = await query<DbEpic>(
			`SELECT * FROM epics WHERE project_id = $1 AND status = 'ready' ORDER BY rank ASC`,
			[projectId]
		);

		// Early return if no active epics
		if (activeResult.rows.length === 0) {
			return context.json({
				inProgressEpics: [],
				readyEpics: readyResult.rows.map((epic) => ({
					id: epic.id,
					title: epic.title,
					specDocPath: epic.spec_doc_path ?? undefined,
					createdAt: epic.created_at.toISOString(),
				})),
			});
		}

		// Batch fetch all tasks and notes for active epics
		const epicIds = activeResult.rows.map((e) => e.id);

		const [tasksResult, notesResult] = await Promise.all([
			query<DbTask>(
				`SELECT * FROM tasks WHERE epic_id = ANY($1) ORDER BY epic_id, rank ASC`,
				[epicIds]
			),
			query<DbProgressNote & { row_num: number }>(
				`SELECT * FROM (
					SELECT *, ROW_NUMBER() OVER (PARTITION BY epic_id ORDER BY created_at DESC) as row_num
					FROM progress_notes
					WHERE epic_id = ANY($1)
				) sub WHERE row_num <= 5`,
				[epicIds]
			),
		]);

		// Group tasks and notes by epic_id
		const tasksByEpic = new Map<string, DbTask[]>();
		const notesByEpic = new Map<string, DbProgressNote[]>();

		for (const task of tasksResult.rows) {
			const epicTasks = tasksByEpic.get(task.epic_id) ?? [];
			epicTasks.push(task);
			tasksByEpic.set(task.epic_id, epicTasks);
		}

		for (const note of notesResult.rows) {
			if (note.epic_id) {
				const epicNotes = notesByEpic.get(note.epic_id) ?? [];
				epicNotes.push(note);
				notesByEpic.set(note.epic_id, epicNotes);
			}
		}

		// Build response for each active epic
		const inProgressEpics = activeResult.rows.map((epic) => {
			const tasks = tasksByEpic.get(epic.id) ?? [];
			const notes = notesByEpic.get(epic.id) ?? [];

			const taskStats: TaskStats = {
				total: tasks.length,
				done: tasks.filter((t) => t.status === 'done').length,
			};

			const currentTask = tasks.find((t) => t.status === 'in_progress');

			return {
				...dbEpicToApi(epic),
				taskStats,
				currentTask: currentTask ? dbTaskToApi(currentTask) : null,
				recentNotes: notes.map(dbProgressNoteToApi),
			};
		});

		return context.json({
			inProgressEpics,
			readyEpics: readyResult.rows.map((epic) => ({
				id: epic.id,
				title: epic.title,
				specDocPath: epic.spec_doc_path ?? undefined,
				createdAt: epic.created_at.toISOString(),
			})),
		});
	} catch (error) {
		console.error('Failed to fetch current work:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleSignalReadyForReview(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const id = context.req.param('id');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid epic ID format' }, 400);
	}

	const body = await context.req.json<{ prUrl?: string }>();

	if (!body.prUrl || typeof body.prUrl !== 'string') {
		return context.json({ error: 'prUrl is required' }, 400);
	}

	try {
		const result = await query<DbEpic>(
			`UPDATE epics SET status = 'in_review', pr_url = $3 WHERE id = $1 AND project_id = $2 RETURNING *`,
			[id, projectId, body.prUrl]
		);

		if (result.rows.length === 0) {
			return context.json({ error: 'Epic not found' }, 404);
		}

		const epic = result.rows[0];
		if (!epic) {
			return context.json({ error: 'Failed to update epic' }, 500);
		}

		return context.json(dbEpicToApi(epic));
	} catch (error) {
		console.error('Failed to signal ready for review:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
