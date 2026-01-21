/**
 * Task-related MCP tools
 *
 * These tools allow Claude to:
 * - Create tasks under epics (create_task, create_tasks)
 * - Update task details (update_task)
 * - Manage task lifecycle (start_task, complete_task, block_task, unblock_task)
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
	createTask as createTaskService,
	createTasks as createTasksService,
	updateTask as updateTaskService,
	startTask as startTaskService,
	completeTask as completeTaskService,
	blockTask as blockTaskService,
	unblockTask as unblockTaskService,
	verifyProjectAccess,
	verifyTaskOwnership,
} from '@doc-platform/db';

export const taskTools: Tool[] = [
	{
		name: 'create_task',
		description:
			'Create a single task under an epic. Use this to add implementation steps after reading the epic spec.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: {
					type: 'string',
					description: 'The UUID of the project',
				},
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
			required: ['project_id', 'epic_id', 'title'],
		},
	},
	{
		name: 'create_tasks',
		description:
			'Create multiple tasks under an epic at once. Use this to add your initial breakdown of the epic into implementation steps.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: {
					type: 'string',
					description: 'The UUID of the project',
				},
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
			required: ['project_id', 'epic_id', 'tasks'],
		},
	},
	{
		name: 'update_task',
		description: 'Update task title or details. Use this to refine task information as work progresses.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: {
					type: 'string',
					description: 'The UUID of the project',
				},
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
			required: ['project_id', 'task_id'],
		},
	},
	{
		name: 'start_task',
		description:
			'Mark a task as in_progress. Use this before beginning work on a task. Also sets the epic to in_progress if it was ready.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: {
					type: 'string',
					description: 'The UUID of the project',
				},
				task_id: {
					type: 'string',
					description: 'The UUID of the task to start',
				},
			},
			required: ['project_id', 'task_id'],
		},
	},
	{
		name: 'complete_task',
		description: 'Mark a task as done. Use this after finishing work on a task.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: {
					type: 'string',
					description: 'The UUID of the project',
				},
				task_id: {
					type: 'string',
					description: 'The UUID of the task to complete',
				},
			},
			required: ['project_id', 'task_id'],
		},
	},
	{
		name: 'block_task',
		description:
			'Mark a task as blocked with a reason. Use this when you cannot proceed due to a dependency or need clarification.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: {
					type: 'string',
					description: 'The UUID of the project',
				},
				task_id: {
					type: 'string',
					description: 'The UUID of the task to block',
				},
				reason: {
					type: 'string',
					description: 'Why the task is blocked',
				},
			},
			required: ['project_id', 'task_id', 'reason'],
		},
	},
	{
		name: 'unblock_task',
		description: 'Remove blocked status from a task, setting it back to ready.',
		inputSchema: {
			type: 'object',
			properties: {
				project_id: {
					type: 'string',
					description: 'The UUID of the project',
				},
				task_id: {
					type: 'string',
					description: 'The UUID of the task to unblock',
				},
			},
			required: ['project_id', 'task_id'],
		},
	},
];

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

export async function handleTaskTool(
	name: string,
	args: Record<string, unknown> | undefined,
	userId: string
): Promise<ToolResult> {
	const projectId = args?.project_id as string;
	if (!projectId) {
		return {
			content: [{ type: 'text', text: 'project_id is required' }],
			isError: true,
		};
	}

	// Security: Verify the user has access to this project
	const hasAccess = await verifyProjectAccess(projectId, userId);
	if (!hasAccess) {
		return {
			content: [{ type: 'text', text: 'Access denied: You do not have permission to access this project' }],
			isError: true,
		};
	}

	try {
		// For operations that take task_id, verify the task belongs to the project
		const taskId = args?.task_id as string | undefined;
		const taskOperations = ['update_task', 'start_task', 'complete_task', 'block_task', 'unblock_task'];
		if (taskId && taskOperations.includes(name)) {
			const taskBelongsToProject = await verifyTaskOwnership(projectId, taskId);
			if (!taskBelongsToProject) {
				return {
					content: [{ type: 'text', text: 'Access denied: Task does not belong to this project' }],
					isError: true,
				};
			}
		}

		switch (name) {
			case 'create_task':
				return await createTask(
					projectId,
					args?.epic_id as string,
					args?.title as string,
					args?.details as string | undefined
				);
			case 'create_tasks':
				return await createTasks(
					projectId,
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
	} catch (error) {
		return {
			content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
			isError: true,
		};
	}
}

async function createTask(
	projectId: string,
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

	const task = await createTaskService(projectId, epicId, { title, details });

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						created: { id: task.id, title: task.title, status: task.status },
					},
					null,
					2
				),
			},
		],
	};
}

async function createTasks(
	projectId: string,
	epicId: string,
	tasks: Array<{ title: string; details?: string }>
): Promise<ToolResult> {
	if (!epicId || !tasks || tasks.length === 0) {
		return {
			content: [{ type: 'text', text: 'epic_id and tasks array are required' }],
			isError: true,
		};
	}

	const created = await createTasksService(projectId, epicId, tasks);

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						created: created.map((t) => ({ id: t.id, title: t.title, status: t.status })),
						count: created.length,
					},
					null,
					2
				),
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

	const task = await updateTaskService(taskId, { title, details });

	if (!task) {
		return {
			content: [{ type: 'text', text: 'Task not found' }],
			isError: true,
		};
	}

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						updated: { id: task.id, title: task.title, status: task.status, details: task.details },
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

	const task = await startTaskService(taskId);

	if (!task) {
		return {
			content: [{ type: 'text', text: 'Task not found' }],
			isError: true,
		};
	}

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						task: { id: task.id, status: task.status },
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

	const task = await completeTaskService(taskId);

	if (!task) {
		return {
			content: [{ type: 'text', text: 'Task not found' }],
			isError: true,
		};
	}

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						task: { id: task.id, status: task.status },
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

	const task = await blockTaskService(taskId, reason);

	if (!task) {
		return {
			content: [{ type: 'text', text: 'Task not found' }],
			isError: true,
		};
	}

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						task: { id: task.id, status: task.status, blockReason: task.blockReason },
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

	const task = await unblockTaskService(taskId);

	if (!task) {
		return {
			content: [{ type: 'text', text: 'Task not found' }],
			isError: true,
		};
	}

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						task: { id: task.id, status: task.status },
						message: 'Task unblocked',
					},
					null,
					2
				),
			},
		],
	};
}
