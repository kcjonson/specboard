/**
 * Task-related MCP tools
 *
 * These tools allow Claude to:
 * - Create tasks under epics (create_task, create_tasks)
 * - Update task details (update_task)
 * - Manage task lifecycle (start_task, complete_task, block_task, unblock_task)
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { query, type Task } from '@doc-platform/db';

export const taskTools: Tool[] = [
	{
		name: 'create_task',
		description:
			'Create a single task under an epic. Use this to add implementation steps after reading the epic spec.',
		inputSchema: {
			type: 'object',
			properties: {
				epic_id: {
					type: 'string',
					description: 'The UUID of the parent epic',
				},
				title: {
					type: 'string',
					description: 'Task title (max 255 chars)',
				},
				details: {
					type: 'string',
					description: 'Optional markdown details/notes for this task',
				},
			},
			required: ['epic_id', 'title'],
		},
	},
	{
		name: 'create_tasks',
		description:
			'Create multiple tasks under an epic at once. Use this to add your initial breakdown of the epic into implementation steps.',
		inputSchema: {
			type: 'object',
			properties: {
				epic_id: {
					type: 'string',
					description: 'The UUID of the parent epic',
				},
				tasks: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							title: {
								type: 'string',
								description: 'Task title',
							},
							details: {
								type: 'string',
								description: 'Optional markdown details',
							},
						},
						required: ['title'],
					},
					description: 'Array of tasks to create',
				},
			},
			required: ['epic_id', 'tasks'],
		},
	},
	{
		name: 'update_task',
		description: 'Update task title or details. Use this to refine task information as work progresses.',
		inputSchema: {
			type: 'object',
			properties: {
				task_id: {
					type: 'string',
					description: 'The UUID of the task to update',
				},
				title: {
					type: 'string',
					description: 'New task title',
				},
				details: {
					type: 'string',
					description: 'New markdown details/notes',
				},
			},
			required: ['task_id'],
		},
	},
	{
		name: 'start_task',
		description:
			'Mark a task as in_progress. Use this before beginning work on a task. Also sets the epic to in_progress if it was ready.',
		inputSchema: {
			type: 'object',
			properties: {
				task_id: {
					type: 'string',
					description: 'The UUID of the task to start',
				},
			},
			required: ['task_id'],
		},
	},
	{
		name: 'complete_task',
		description: 'Mark a task as done. Use this after finishing work on a task.',
		inputSchema: {
			type: 'object',
			properties: {
				task_id: {
					type: 'string',
					description: 'The UUID of the task to complete',
				},
			},
			required: ['task_id'],
		},
	},
	{
		name: 'block_task',
		description:
			'Mark a task as blocked with a reason. Use this when you cannot proceed due to a dependency or need clarification.',
		inputSchema: {
			type: 'object',
			properties: {
				task_id: {
					type: 'string',
					description: 'The UUID of the task to block',
				},
				reason: {
					type: 'string',
					description: 'Why the task is blocked',
				},
			},
			required: ['task_id', 'reason'],
		},
	},
	{
		name: 'unblock_task',
		description: 'Remove blocked status from a task, setting it back to ready.',
		inputSchema: {
			type: 'object',
			properties: {
				task_id: {
					type: 'string',
					description: 'The UUID of the task to unblock',
				},
			},
			required: ['task_id'],
		},
	},
];

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

export async function handleTaskTool(
	name: string,
	args: Record<string, unknown> | undefined
): Promise<ToolResult> {
	switch (name) {
		case 'create_task':
			return await createTask(
				args?.epic_id as string,
				args?.title as string,
				args?.details as string | undefined
			);
		case 'create_tasks':
			return await createTasks(
				args?.epic_id as string,
				args?.tasks as Array<{ title: string; details?: string }>
			);
		case 'update_task':
			return await updateTask(
				args?.task_id as string,
				args?.title as string | undefined,
				args?.details as string | undefined
			);
		case 'start_task':
			return await startTask(args?.task_id as string);
		case 'complete_task':
			return await completeTask(args?.task_id as string);
		case 'block_task':
			return await blockTask(args?.task_id as string, args?.reason as string);
		case 'unblock_task':
			return await unblockTask(args?.task_id as string);
		default:
			return {
				content: [{ type: 'text', text: `Unknown task tool: ${name}` }],
				isError: true,
			};
	}
}

async function createTask(
	epicId: string,
	title: string,
	details?: string
): Promise<ToolResult> {
	if (!epicId || !title) {
		return {
			content: [{ type: 'text', text: 'epic_id and title are required' }],
			isError: true,
		};
	}

	// Check epic exists
	const epicCheck = await query(`SELECT id FROM epics WHERE id = $1`, [epicId]);
	if (epicCheck.rows.length === 0) {
		return {
			content: [{ type: 'text', text: `Epic not found: ${epicId}` }],
			isError: true,
		};
	}

	// Get max rank
	const rankResult = await query<{ max_rank: number | null }>(
		`SELECT MAX(rank) as max_rank FROM tasks WHERE epic_id = $1`,
		[epicId]
	);
	const maxRank = rankResult.rows[0]?.max_rank ?? 0;

	// Create task
	const result = await query<Task>(
		`INSERT INTO tasks (epic_id, title, details, status, rank)
		 VALUES ($1, $2, $3, 'ready', $4)
		 RETURNING *`,
		[epicId, title, details ?? null, maxRank + 1]
	);

	const task = result.rows[0];
	if (!task) {
		return {
			content: [{ type: 'text', text: 'Failed to create task' }],
			isError: true,
		};
	}

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						created: {
							id: task.id,
							title: task.title,
							status: task.status,
						},
					},
					null,
					2
				),
			},
		],
	};
}

async function createTasks(
	epicId: string,
	tasks: Array<{ title: string; details?: string }>
): Promise<ToolResult> {
	if (!epicId || !tasks || tasks.length === 0) {
		return {
			content: [{ type: 'text', text: 'epic_id and tasks array are required' }],
			isError: true,
		};
	}

	// Check epic exists
	const epicCheck = await query(`SELECT id FROM epics WHERE id = $1`, [epicId]);
	if (epicCheck.rows.length === 0) {
		return {
			content: [{ type: 'text', text: `Epic not found: ${epicId}` }],
			isError: true,
		};
	}

	// Get max rank
	const rankResult = await query<{ max_rank: number | null }>(
		`SELECT MAX(rank) as max_rank FROM tasks WHERE epic_id = $1`,
		[epicId]
	);
	let currentRank = (rankResult.rows[0]?.max_rank ?? 0) + 1;

	// Build batched INSERT with multiple VALUES tuples
	const values: unknown[] = [];
	const valueTuples: string[] = [];

	for (const task of tasks) {
		const paramOffset = values.length;
		valueTuples.push(
			`($${paramOffset + 1}, $${paramOffset + 2}, $${paramOffset + 3}, 'ready', $${paramOffset + 4})`
		);
		values.push(epicId, task.title, task.details ?? null, currentRank++);
	}

	const result = await query<Task>(
		`INSERT INTO tasks (epic_id, title, details, status, rank)
		 VALUES ${valueTuples.join(', ')}
		 RETURNING id, title, status`,
		values
	);

	if (result.rows.length !== tasks.length) {
		return {
			content: [{ type: 'text', text: 'Failed to create all tasks' }],
			isError: true,
		};
	}

	const created = result.rows.map((t) => ({ id: t.id, title: t.title, status: t.status }));

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify({ created, count: created.length }, null, 2),
			},
		],
	};
}

async function updateTask(
	taskId: string,
	title?: string,
	details?: string
): Promise<ToolResult> {
	if (!taskId) {
		return {
			content: [{ type: 'text', text: 'task_id is required' }],
			isError: true,
		};
	}

	if (!title && details === undefined) {
		return {
			content: [{ type: 'text', text: 'At least one of title or details must be provided' }],
			isError: true,
		};
	}

	const updates: string[] = [];
	const values: unknown[] = [];
	let paramIndex = 1;

	if (title) {
		updates.push(`title = $${paramIndex++}`);
		values.push(title);
	}
	if (details !== undefined) {
		updates.push(`details = $${paramIndex++}`);
		values.push(details);
	}

	values.push(taskId);

	const result = await query<Task>(
		`UPDATE tasks SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
		values
	);

	const task = result.rows[0];
	if (!task) {
		return {
			content: [{ type: 'text', text: `Task not found: ${taskId}` }],
			isError: true,
		};
	}

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						updated: {
							id: task.id,
							title: task.title,
							status: task.status,
							details: task.details,
						},
					},
					null,
					2
				),
			},
		],
	};
}

async function startTask(taskId: string): Promise<ToolResult> {
	if (!taskId) {
		return {
			content: [{ type: 'text', text: 'task_id is required' }],
			isError: true,
		};
	}

	// Get task and epic
	const taskResult = await query<Task>(`SELECT * FROM tasks WHERE id = $1`, [taskId]);
	const task = taskResult.rows[0];
	if (!task) {
		return {
			content: [{ type: 'text', text: `Task not found: ${taskId}` }],
			isError: true,
		};
	}

	// Update task to in_progress
	await query(`UPDATE tasks SET status = 'in_progress' WHERE id = $1`, [taskId]);

	// If epic is 'ready', set it to 'in_progress'
	await query(
		`UPDATE epics SET status = 'in_progress' WHERE id = $1 AND status = 'ready'`,
		[task.epic_id]
	);

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						task: { id: taskId, status: 'in_progress' },
						message: 'Task started',
					},
					null,
					2
				),
			},
		],
	};
}

async function completeTask(taskId: string): Promise<ToolResult> {
	if (!taskId) {
		return {
			content: [{ type: 'text', text: 'task_id is required' }],
			isError: true,
		};
	}

	const result = await query<Task>(
		`UPDATE tasks SET status = 'done' WHERE id = $1 RETURNING *`,
		[taskId]
	);

	if (result.rows.length === 0) {
		return {
			content: [{ type: 'text', text: `Task not found: ${taskId}` }],
			isError: true,
		};
	}

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						task: { id: taskId, status: 'done' },
						message: 'Task completed',
					},
					null,
					2
				),
			},
		],
	};
}

async function blockTask(taskId: string, reason: string): Promise<ToolResult> {
	if (!taskId || !reason) {
		return {
			content: [{ type: 'text', text: 'task_id and reason are required' }],
			isError: true,
		};
	}

	const result = await query<Task>(
		`UPDATE tasks SET status = 'blocked', block_reason = $2 WHERE id = $1 RETURNING *`,
		[taskId, reason]
	);

	if (result.rows.length === 0) {
		return {
			content: [{ type: 'text', text: `Task not found: ${taskId}` }],
			isError: true,
		};
	}

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						task: { id: taskId, status: 'blocked', blockReason: reason },
						message: 'Task blocked',
					},
					null,
					2
				),
			},
		],
	};
}

async function unblockTask(taskId: string): Promise<ToolResult> {
	if (!taskId) {
		return {
			content: [{ type: 'text', text: 'task_id is required' }],
			isError: true,
		};
	}

	const result = await query<Task>(
		`UPDATE tasks SET status = 'ready', block_reason = NULL WHERE id = $1 RETURNING *`,
		[taskId]
	);

	if (result.rows.length === 0) {
		return {
			content: [{ type: 'text', text: `Task not found: ${taskId}` }],
			isError: true,
		};
	}

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						task: { id: taskId, status: 'ready' },
						message: 'Task unblocked',
					},
					null,
					2
				),
			},
		],
	};
}
