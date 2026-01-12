/**
 * Task service - shared business logic for tasks
 */

import { query } from '../index.ts';
import type { Task, TaskStatus } from '../types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Response types (camelCase for API/MCP responses)
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskResponse {
	id: string;
	epicId: string;
	title: string;
	status: TaskStatus;
	assignee: string | null;
	dueDate: Date | null;
	rank: number;
	details: string | null;
	blockReason: string | null;
	createdAt: Date;
	updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

function transformTask(task: Task): TaskResponse {
	return {
		id: task.id,
		epicId: task.epic_id,
		title: task.title,
		status: task.status,
		assignee: task.assignee,
		dueDate: task.due_date,
		rank: task.rank,
		details: task.details,
		blockReason: task.block_reason,
		createdAt: task.created_at,
		updatedAt: task.updated_at,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Service functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get all tasks for an epic
 */
export async function getTasks(epicId: string): Promise<TaskResponse[]> {
	const result = await query<Task>(
		'SELECT * FROM tasks WHERE epic_id = $1 ORDER BY rank ASC',
		[epicId]
	);
	return result.rows.map(transformTask);
}

/**
 * Get a single task by ID
 */
export async function getTask(taskId: string): Promise<TaskResponse | null> {
	const result = await query<Task>('SELECT * FROM tasks WHERE id = $1', [taskId]);
	if (result.rows.length === 0) return null;
	return transformTask(result.rows[0]!);
}

/**
 * Verify epic exists and belongs to project
 */
export async function verifyEpicOwnership(
	projectId: string,
	epicId: string
): Promise<boolean> {
	const result = await query(
		'SELECT id FROM epics WHERE id = $1 AND project_id = $2',
		[epicId, projectId]
	);
	return result.rows.length > 0;
}

/**
 * Create a single task
 */
export interface CreateTaskInput {
	title: string;
	details?: string;
	assignee?: string;
	dueDate?: Date;
}

export async function createTask(
	projectId: string,
	epicId: string,
	data: CreateTaskInput
): Promise<TaskResponse> {
	// Verify epic belongs to project
	const epicExists = await verifyEpicOwnership(projectId, epicId);
	if (!epicExists) {
		throw new Error('Epic not found');
	}

	// Get next rank
	const rankResult = await query<{ max: number }>(
		'SELECT COALESCE(MAX(rank), 0) as max FROM tasks WHERE epic_id = $1',
		[epicId]
	);
	const nextRank = (rankResult.rows[0]?.max ?? 0) + 1;

	const result = await query<Task>(
		`INSERT INTO tasks (epic_id, title, details, status, assignee, due_date, rank)
		 VALUES ($1, $2, $3, 'ready', $4, $5, $6)
		 RETURNING *`,
		[epicId, data.title, data.details || null, data.assignee || null, data.dueDate || null, nextRank]
	);

	return transformTask(result.rows[0]!);
}

/**
 * Create multiple tasks at once
 */
export async function createTasks(
	projectId: string,
	epicId: string,
	tasks: CreateTaskInput[]
): Promise<TaskResponse[]> {
	// Verify epic belongs to project
	const epicExists = await verifyEpicOwnership(projectId, epicId);
	if (!epicExists) {
		throw new Error('Epic not found');
	}

	// Get current max rank
	const rankResult = await query<{ max: number }>(
		'SELECT COALESCE(MAX(rank), 0) as max FROM tasks WHERE epic_id = $1',
		[epicId]
	);
	let nextRank = (rankResult.rows[0]?.max ?? 0) + 1;

	const created: TaskResponse[] = [];

	for (const taskData of tasks) {
		const result = await query<Task>(
			`INSERT INTO tasks (epic_id, title, details, status, rank)
			 VALUES ($1, $2, $3, 'ready', $4)
			 RETURNING *`,
			[epicId, taskData.title, taskData.details || null, nextRank++]
		);
		created.push(transformTask(result.rows[0]!));
	}

	return created;
}

/**
 * Update a task
 */
export interface UpdateTaskInput {
	title?: string;
	details?: string;
	status?: TaskStatus;
	rank?: number;
	assignee?: string;
	dueDate?: Date;
	blockReason?: string;
}

export async function updateTask(
	taskId: string,
	data: UpdateTaskInput
): Promise<TaskResponse | null> {
	const updates: string[] = [];
	const values: unknown[] = [];
	let paramIndex = 1;

	if (data.title !== undefined) {
		updates.push(`title = $${paramIndex++}`);
		values.push(data.title);
	}
	if (data.details !== undefined) {
		updates.push(`details = $${paramIndex++}`);
		values.push(data.details);
	}
	if (data.status !== undefined) {
		updates.push(`status = $${paramIndex++}`);
		values.push(data.status);
	}
	if (data.rank !== undefined) {
		updates.push(`rank = $${paramIndex++}`);
		values.push(data.rank);
	}
	if (data.assignee !== undefined) {
		updates.push(`assignee = $${paramIndex++}`);
		values.push(data.assignee);
	}
	if (data.dueDate !== undefined) {
		updates.push(`due_date = $${paramIndex++}`);
		values.push(data.dueDate);
	}
	if (data.blockReason !== undefined) {
		updates.push(`block_reason = $${paramIndex++}`);
		values.push(data.blockReason);
	}

	if (updates.length === 0) {
		return getTask(taskId);
	}

	updates.push('updated_at = NOW()');
	values.push(taskId);

	const result = await query<Task>(
		`UPDATE tasks SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
		values
	);

	if (result.rows.length === 0) return null;
	return transformTask(result.rows[0]!);
}

/**
 * Delete a task
 */
export async function deleteTask(taskId: string): Promise<boolean> {
	const result = await query('DELETE FROM tasks WHERE id = $1', [taskId]);
	return (result.rowCount ?? 0) > 0;
}

/**
 * Start a task - sets status to in_progress and updates parent epic if needed
 */
export async function startTask(taskId: string): Promise<TaskResponse | null> {
	const result = await query<Task>(
		`UPDATE tasks SET status = 'in_progress', updated_at = NOW() WHERE id = $1 RETURNING *`,
		[taskId]
	);

	if (result.rows.length === 0) return null;

	const task = result.rows[0]!;

	// Also set epic to in_progress if it was ready
	await query(
		`UPDATE epics SET status = 'in_progress', updated_at = NOW()
		 WHERE id = $1 AND status = 'ready'`,
		[task.epic_id]
	);

	return transformTask(task);
}

/**
 * Complete a task - sets status to done
 */
export async function completeTask(taskId: string): Promise<TaskResponse | null> {
	const result = await query<Task>(
		`UPDATE tasks SET status = 'done', updated_at = NOW() WHERE id = $1 RETURNING *`,
		[taskId]
	);

	if (result.rows.length === 0) return null;
	return transformTask(result.rows[0]!);
}

/**
 * Block a task with a reason
 */
export async function blockTask(
	taskId: string,
	reason: string
): Promise<TaskResponse | null> {
	const result = await query<Task>(
		`UPDATE tasks SET status = 'blocked', block_reason = $2, updated_at = NOW()
		 WHERE id = $1 RETURNING *`,
		[taskId, reason]
	);

	if (result.rows.length === 0) return null;
	return transformTask(result.rows[0]!);
}

/**
 * Unblock a task - sets status back to ready
 */
export async function unblockTask(taskId: string): Promise<TaskResponse | null> {
	const result = await query<Task>(
		`UPDATE tasks SET status = 'ready', block_reason = NULL, updated_at = NOW()
		 WHERE id = $1 RETURNING *`,
		[taskId]
	);

	if (result.rows.length === 0) return null;
	return transformTask(result.rows[0]!);
}
