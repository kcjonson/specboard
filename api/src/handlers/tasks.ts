/**
 * Task handlers
 */

import type { Context } from 'hono';
import { query, type Task as DbTask } from '@doc-platform/db';
import type { ApiTask } from '../types.js';
import { dbTaskToApi } from '../transform.js';
import {
	isValidUUID,
	isValidOptionalUUID,
	isValidStatus,
	isValidTitle,
	isValidDateFormat,
	normalizeOptionalString,
	MAX_TITLE_LENGTH,
} from '../validation.js';

export async function handleListTasks(context: Context): Promise<Response> {
	const epicId = context.req.param('epicId');

	if (!isValidUUID(epicId)) {
		return context.json({ error: 'Invalid epic ID format' }, 400);
	}

	try {
		const epicResult = await query(`SELECT id FROM epics WHERE id = $1`, [epicId]);
		if (epicResult.rows.length === 0) {
			return context.json({ error: 'Epic not found' }, 404);
		}

		const result = await query<DbTask>(
			`SELECT * FROM tasks WHERE epic_id = $1 ORDER BY rank ASC`,
			[epicId]
		);

		return context.json(result.rows.map(dbTaskToApi));
	} catch (error) {
		console.error('Failed to fetch tasks:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleCreateTask(context: Context): Promise<Response> {
	const epicId = context.req.param('epicId');

	if (!isValidUUID(epicId)) {
		return context.json({ error: 'Invalid epic ID format' }, 400);
	}

	const body = await context.req.json<Partial<ApiTask>>();
	const title = body.title || 'Untitled Task';

	if (body.status !== undefined && !isValidStatus(body.status)) {
		return context.json({ error: 'Invalid status. Must be one of: ready, in_progress, done' }, 400);
	}

	if (!isValidTitle(title)) {
		return context.json({ error: `Title must be between 1 and ${MAX_TITLE_LENGTH} characters` }, 400);
	}

	if (!isValidOptionalUUID(body.assignee)) {
		return context.json({ error: 'Invalid assignee. Must be a valid UUID' }, 400);
	}

	if (body.dueDate !== undefined && body.dueDate !== '' && !isValidDateFormat(body.dueDate)) {
		return context.json({ error: 'Invalid dueDate. Must be in YYYY-MM-DD format' }, 400);
	}

	try {
		const epicResult = await query(`SELECT id FROM epics WHERE id = $1`, [epicId]);
		if (epicResult.rows.length === 0) {
			return context.json({ error: 'Epic not found' }, 404);
		}

		const rankResult = await query<{ max_rank: number | null }>(
			`SELECT MAX(rank) as max_rank FROM tasks WHERE epic_id = $1`,
			[epicId]
		);
		const maxRank = rankResult.rows[0]?.max_rank ?? 0;

		const result = await query<DbTask>(
			`INSERT INTO tasks (epic_id, title, status, assignee, due_date, rank)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 RETURNING *`,
			[
				epicId,
				title,
				body.status || 'ready',
				normalizeOptionalString(body.assignee) ?? null,
				body.dueDate || null,
				maxRank + 1,
			]
		);

		const task = result.rows[0];
		if (!task) {
			return context.json({ error: 'Failed to create task' }, 500);
		}

		return context.json(dbTaskToApi(task), 201);
	} catch (error) {
		console.error('Failed to create task:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleUpdateTask(context: Context): Promise<Response> {
	const id = context.req.param('id');

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid task ID format' }, 400);
	}

	const body = await context.req.json<Partial<ApiTask>>();

	if (body.status !== undefined && !isValidStatus(body.status)) {
		return context.json({ error: 'Invalid status. Must be one of: ready, in_progress, done' }, 400);
	}

	if (body.title !== undefined && !isValidTitle(body.title)) {
		return context.json({ error: `Title must be between 1 and ${MAX_TITLE_LENGTH} characters` }, 400);
	}

	if (!isValidOptionalUUID(body.assignee)) {
		return context.json({ error: 'Invalid assignee. Must be a valid UUID' }, 400);
	}

	if (body.dueDate !== undefined && body.dueDate !== '' && !isValidDateFormat(body.dueDate)) {
		return context.json({ error: 'Invalid dueDate. Must be in YYYY-MM-DD format' }, 400);
	}

	try {
		const updates: string[] = [];
		const values: unknown[] = [];
		let paramIndex = 1;

		if (body.title !== undefined) {
			updates.push(`title = $${paramIndex++}`);
			values.push(body.title);
		}
		if (body.status !== undefined) {
			updates.push(`status = $${paramIndex++}`);
			values.push(body.status);
		}
		if (body.assignee !== undefined) {
			updates.push(`assignee = $${paramIndex++}`);
			const normalized = normalizeOptionalString(body.assignee);
			values.push(normalized === undefined ? null : normalized);
		}
		if (body.dueDate !== undefined) {
			updates.push(`due_date = $${paramIndex++}`);
			values.push(body.dueDate || null);
		}
		if (body.rank !== undefined) {
			updates.push(`rank = $${paramIndex++}`);
			values.push(body.rank);
		}

		if (updates.length === 0) {
			const result = await query<DbTask>(`SELECT * FROM tasks WHERE id = $1`, [id]);
			if (result.rows.length === 0) {
				return context.json({ error: 'Task not found' }, 404);
			}
			const task = result.rows[0];
			if (!task) {
				return context.json({ error: 'Task not found' }, 404);
			}
			return context.json(dbTaskToApi(task));
		}

		values.push(id);

		if (paramIndex !== values.length) {
			console.error(`Parameter index mismatch: expected ${paramIndex} to equal ${values.length}`);
			return context.json({ error: 'Internal server error' }, 500);
		}

		const result = await query<DbTask>(
			`UPDATE tasks SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
			values
		);

		if (result.rows.length === 0) {
			return context.json({ error: 'Task not found' }, 404);
		}

		const task = result.rows[0];
		if (!task) {
			return context.json({ error: 'Failed to update task' }, 500);
		}

		return context.json(dbTaskToApi(task));
	} catch (error) {
		console.error('Failed to update task:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleDeleteTask(context: Context): Promise<Response> {
	const id = context.req.param('id');

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid task ID format' }, 400);
	}

	try {
		const result = await query<{ id: string }>(`DELETE FROM tasks WHERE id = $1 RETURNING id`, [id]);

		if (result.rows.length === 0) {
			return context.json({ error: 'Task not found' }, 404);
		}

		return context.json({ success: true });
	} catch (error) {
		console.error('Failed to delete task:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
