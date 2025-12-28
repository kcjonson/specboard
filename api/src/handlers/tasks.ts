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

// Helper to verify task belongs to project (via epic)
async function verifyTaskInProject(taskId: string, projectId: string): Promise<DbTask | null> {
	const result = await query<DbTask>(
		`SELECT t.* FROM tasks t
		 JOIN epics e ON t.epic_id = e.id
		 WHERE t.id = $1 AND e.project_id = $2`,
		[taskId, projectId]
	);
	return result.rows[0] ?? null;
}

export async function handleListTasks(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const epicId = context.req.param('epicId');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	if (!isValidUUID(epicId)) {
		return context.json({ error: 'Invalid epic ID format' }, 400);
	}

	try {
		const epicResult = await query(
			`SELECT id FROM epics WHERE id = $1 AND project_id = $2`,
			[epicId, projectId]
		);
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
	const projectId = context.req.param('projectId');
	const epicId = context.req.param('epicId');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

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
		const epicResult = await query(
			`SELECT id FROM epics WHERE id = $1 AND project_id = $2`,
			[epicId, projectId]
		);
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
	const projectId = context.req.param('projectId');
	const id = context.req.param('id');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

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
		// Verify task belongs to project
		const existingTask = await verifyTaskInProject(id, projectId);
		if (!existingTask) {
			return context.json({ error: 'Task not found' }, 404);
		}

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
			return context.json(dbTaskToApi(existingTask));
		}

		values.push(id);

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
	const projectId = context.req.param('projectId');
	const id = context.req.param('id');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid task ID format' }, 400);
	}

	try {
		// Verify task belongs to project and delete
		const result = await query<{ id: string }>(
			`DELETE FROM tasks
			 WHERE id = $1 AND epic_id IN (SELECT id FROM epics WHERE project_id = $2)
			 RETURNING id`,
			[id, projectId]
		);

		if (result.rows.length === 0) {
			return context.json({ error: 'Task not found' }, 404);
		}

		return context.json({ success: true });
	} catch (error) {
		console.error('Failed to delete task:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

interface BulkCreateTaskInput {
	title: string;
	details?: string;
}

export async function handleBulkCreateTasks(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const epicId = context.req.param('epicId');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	if (!isValidUUID(epicId)) {
		return context.json({ error: 'Invalid epic ID format' }, 400);
	}

	const body = await context.req.json<{ tasks?: BulkCreateTaskInput[] }>();
	const tasks = body.tasks;

	if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
		return context.json({ error: 'tasks array is required and must not be empty' }, 400);
	}

	if (tasks.length > 50) {
		return context.json({ error: 'Cannot create more than 50 tasks at once' }, 400);
	}

	// Validate all task titles
	for (const task of tasks) {
		if (!task.title || !isValidTitle(task.title)) {
			return context.json(
				{ error: `Each task must have a title between 1 and ${MAX_TITLE_LENGTH} characters` },
				400
			);
		}
	}

	try {
		const epicResult = await query(
			`SELECT id FROM epics WHERE id = $1 AND project_id = $2`,
			[epicId, projectId]
		);
		if (epicResult.rows.length === 0) {
			return context.json({ error: 'Epic not found' }, 404);
		}

		// Get max rank
		const rankResult = await query<{ max_rank: number | null }>(
			`SELECT MAX(rank) as max_rank FROM tasks WHERE epic_id = $1`,
			[epicId]
		);
		let currentRank = (rankResult.rows[0]?.max_rank ?? 0) + 1;

		// Build batched INSERT
		const values: unknown[] = [];
		const valueTuples: string[] = [];

		for (const task of tasks) {
			const paramOffset = values.length;
			valueTuples.push(
				`($${paramOffset + 1}, $${paramOffset + 2}, $${paramOffset + 3}, 'ready', $${paramOffset + 4})`
			);
			values.push(epicId, task.title, task.details ?? null, currentRank++);
		}

		const result = await query<DbTask>(
			`INSERT INTO tasks (epic_id, title, details, status, rank)
			 VALUES ${valueTuples.join(', ')}
			 RETURNING *`,
			values
		);

		return context.json(result.rows.map(dbTaskToApi), 201);
	} catch (error) {
		console.error('Failed to bulk create tasks:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleStartTask(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const id = context.req.param('id');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid task ID format' }, 400);
	}

	try {
		// Verify task belongs to project
		const task = await verifyTaskInProject(id, projectId);
		if (!task) {
			return context.json({ error: 'Task not found' }, 404);
		}

		// Update task to in_progress
		const result = await query<DbTask>(
			`UPDATE tasks SET status = 'in_progress' WHERE id = $1 RETURNING *`,
			[id]
		);

		// If epic is 'ready', set it to 'in_progress'
		await query(
			`UPDATE epics SET status = 'in_progress' WHERE id = $1 AND status = 'ready'`,
			[task.epic_id]
		);

		const updatedTask = result.rows[0];
		if (!updatedTask) {
			return context.json({ error: 'Failed to start task' }, 500);
		}

		return context.json(dbTaskToApi(updatedTask));
	} catch (error) {
		console.error('Failed to start task:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleCompleteTask(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const id = context.req.param('id');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid task ID format' }, 400);
	}

	try {
		// Verify task belongs to project
		const existingTask = await verifyTaskInProject(id, projectId);
		if (!existingTask) {
			return context.json({ error: 'Task not found' }, 404);
		}

		const result = await query<DbTask>(
			`UPDATE tasks SET status = 'done' WHERE id = $1 RETURNING *`,
			[id]
		);

		if (result.rows.length === 0) {
			return context.json({ error: 'Task not found' }, 404);
		}

		const task = result.rows[0];
		if (!task) {
			return context.json({ error: 'Failed to complete task' }, 500);
		}

		return context.json(dbTaskToApi(task));
	} catch (error) {
		console.error('Failed to complete task:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleBlockTask(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const id = context.req.param('id');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid task ID format' }, 400);
	}

	const body = await context.req.json<{ reason?: string }>();

	if (!body.reason || typeof body.reason !== 'string') {
		return context.json({ error: 'reason is required' }, 400);
	}

	try {
		// Verify task belongs to project
		const existingTask = await verifyTaskInProject(id, projectId);
		if (!existingTask) {
			return context.json({ error: 'Task not found' }, 404);
		}

		const result = await query<DbTask>(
			`UPDATE tasks SET status = 'blocked', block_reason = $2 WHERE id = $1 RETURNING *`,
			[id, body.reason]
		);

		if (result.rows.length === 0) {
			return context.json({ error: 'Task not found' }, 404);
		}

		const task = result.rows[0];
		if (!task) {
			return context.json({ error: 'Failed to block task' }, 500);
		}

		return context.json(dbTaskToApi(task));
	} catch (error) {
		console.error('Failed to block task:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleUnblockTask(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const id = context.req.param('id');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid task ID format' }, 400);
	}

	try {
		// Verify task belongs to project
		const existingTask = await verifyTaskInProject(id, projectId);
		if (!existingTask) {
			return context.json({ error: 'Task not found' }, 404);
		}

		const result = await query<DbTask>(
			`UPDATE tasks SET status = 'ready', block_reason = NULL WHERE id = $1 RETURNING *`,
			[id]
		);

		if (result.rows.length === 0) {
			return context.json({ error: 'Task not found' }, 404);
		}

		const task = result.rows[0];
		if (!task) {
			return context.json({ error: 'Failed to unblock task' }, 500);
		}

		return context.json(dbTaskToApi(task));
	} catch (error) {
		console.error('Failed to unblock task:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
