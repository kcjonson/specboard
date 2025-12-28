/**
 * Progress notes handlers
 */

import type { Context } from 'hono';
import { query, type ProgressNote as DbProgressNote } from '@doc-platform/db';
import { dbProgressNoteToApi } from '../transform.js';
import { isValidUUID } from '../validation.js';

export async function handleListEpicProgress(context: Context): Promise<Response> {
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

		const result = await query<DbProgressNote>(
			`SELECT * FROM progress_notes WHERE epic_id = $1 ORDER BY created_at DESC`,
			[epicId]
		);

		return context.json(result.rows.map(dbProgressNoteToApi));
	} catch (error) {
		console.error('Failed to fetch epic progress notes:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleCreateEpicProgress(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const epicId = context.req.param('epicId');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	if (!isValidUUID(epicId)) {
		return context.json({ error: 'Invalid epic ID format' }, 400);
	}

	const body = await context.req.json<{ note?: string; createdBy?: string }>();

	if (!body.note || typeof body.note !== 'string' || body.note.trim() === '') {
		return context.json({ error: 'note is required' }, 400);
	}

	try {
		const epicResult = await query(
			`SELECT id FROM epics WHERE id = $1 AND project_id = $2`,
			[epicId, projectId]
		);
		if (epicResult.rows.length === 0) {
			return context.json({ error: 'Epic not found' }, 404);
		}

		const result = await query<DbProgressNote>(
			`INSERT INTO progress_notes (epic_id, note, created_by)
			 VALUES ($1, $2, $3)
			 RETURNING *`,
			[epicId, body.note.trim(), body.createdBy ?? 'claude']
		);

		const progressNote = result.rows[0];
		if (!progressNote) {
			return context.json({ error: 'Failed to create progress note' }, 500);
		}

		return context.json(dbProgressNoteToApi(progressNote), 201);
	} catch (error) {
		console.error('Failed to create epic progress note:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleListTaskProgress(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const taskId = context.req.param('taskId');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	if (!isValidUUID(taskId)) {
		return context.json({ error: 'Invalid task ID format' }, 400);
	}

	try {
		// Verify task belongs to project (via epic)
		const taskResult = await query(
			`SELECT t.id FROM tasks t
			 JOIN epics e ON t.epic_id = e.id
			 WHERE t.id = $1 AND e.project_id = $2`,
			[taskId, projectId]
		);
		if (taskResult.rows.length === 0) {
			return context.json({ error: 'Task not found' }, 404);
		}

		const result = await query<DbProgressNote>(
			`SELECT * FROM progress_notes WHERE task_id = $1 ORDER BY created_at DESC`,
			[taskId]
		);

		return context.json(result.rows.map(dbProgressNoteToApi));
	} catch (error) {
		console.error('Failed to fetch task progress notes:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}

export async function handleCreateTaskProgress(context: Context): Promise<Response> {
	const projectId = context.req.param('projectId');
	const taskId = context.req.param('taskId');

	if (!isValidUUID(projectId)) {
		return context.json({ error: 'Invalid project ID format' }, 400);
	}

	if (!isValidUUID(taskId)) {
		return context.json({ error: 'Invalid task ID format' }, 400);
	}

	const body = await context.req.json<{ note?: string; createdBy?: string }>();

	if (!body.note || typeof body.note !== 'string' || body.note.trim() === '') {
		return context.json({ error: 'note is required' }, 400);
	}

	try {
		// Verify task belongs to project (via epic)
		const taskResult = await query(
			`SELECT t.id FROM tasks t
			 JOIN epics e ON t.epic_id = e.id
			 WHERE t.id = $1 AND e.project_id = $2`,
			[taskId, projectId]
		);
		if (taskResult.rows.length === 0) {
			return context.json({ error: 'Task not found' }, 404);
		}

		const result = await query<DbProgressNote>(
			`INSERT INTO progress_notes (task_id, note, created_by)
			 VALUES ($1, $2, $3)
			 RETURNING *`,
			[taskId, body.note.trim(), body.createdBy ?? 'claude']
		);

		const progressNote = result.rows[0];
		if (!progressNote) {
			return context.json({ error: 'Failed to create progress note' }, 500);
		}

		return context.json(dbProgressNoteToApi(progressNote), 201);
	} catch (error) {
		console.error('Failed to create task progress note:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
