/**
 * Epic handlers
 */

import type { Context } from 'hono';
import { query, type Epic as DbEpic, type Task as DbTask } from '@doc-platform/db';
import type { ApiEpic, TaskStats } from '../types.js';
import { dbEpicToApi, dbTaskToApi } from '../transform.js';
import {
	isValidUUID,
	isValidOptionalUUID,
	isValidStatus,
	isValidTitle,
	normalizeOptionalString,
	MAX_TITLE_LENGTH,
} from '../validation.js';

export async function handleListEpics(context: Context): Promise<Response> {
	try {
		const result = await query<DbEpic>(`
			SELECT * FROM epics ORDER BY rank ASC
		`);

		const statsResult = await query<{ epic_id: string; total: string; done: string }>(`
			SELECT
				epic_id,
				COUNT(*)::text as total,
				COUNT(*) FILTER (WHERE status = 'done')::text as done
			FROM tasks
			GROUP BY epic_id
		`);

		const statsMap = new Map(
			statsResult.rows.map((row) => [
				row.epic_id,
				{ total: parseInt(row.total, 10), done: parseInt(row.done, 10) },
			])
		);

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
	const id = context.req.param('id');

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid epic ID format' }, 400);
	}

	try {
		const epicResult = await query<DbEpic>(`SELECT * FROM epics WHERE id = $1`, [id]);
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
		const rankResult = await query<{ max_rank: number | null }>(
			`SELECT MAX(rank) as max_rank FROM epics WHERE status = $1`,
			[status]
		);
		const maxRank = rankResult.rows[0]?.max_rank ?? 0;

		const result = await query<DbEpic>(
			`INSERT INTO epics (title, description, status, creator, assignee, rank)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 RETURNING *`,
			[
				title,
				normalizeOptionalString(body.description) ?? null,
				status,
				normalizeOptionalString(body.creator) ?? null,
				normalizeOptionalString(body.assignee) ?? null,
				maxRank + 1,
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
	const id = context.req.param('id');

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

		if (updates.length === 0) {
			const result = await query<DbEpic>(`SELECT * FROM epics WHERE id = $1`, [id]);
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

		if (paramIndex !== values.length) {
			console.error(`Parameter index mismatch: expected ${paramIndex} to equal ${values.length}`);
			return context.json({ error: 'Internal server error' }, 500);
		}

		const result = await query<DbEpic>(
			`UPDATE epics SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
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
	const id = context.req.param('id');

	if (!isValidUUID(id)) {
		return context.json({ error: 'Invalid epic ID format' }, 400);
	}

	try {
		const result = await query<{ id: string }>(`DELETE FROM epics WHERE id = $1 RETURNING id`, [id]);

		if (result.rows.length === 0) {
			return context.json({ error: 'Epic not found' }, 404);
		}

		return context.json({ success: true });
	} catch (error) {
		console.error('Failed to delete epic:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
