/**
 * Write handlers for work item MCP tools.
 *
 * Handles: create_item, create_items, update_item, delete_item
 */

import {
	createEpic as createEpicService,
	updateEpic as updateEpicService,
	deleteEpic as deleteEpicService,
	createTask as createTaskService,
	createTasks as createTasksService,
	updateTask as updateTaskService,
	deleteTask as deleteTaskService,
	startTask as startTaskService,
	completeTask as completeTaskService,
	blockTask as blockTaskService,
	unblockTask as unblockTaskService,
	verifyEpicOwnership,
	verifyTaskOwnership,
	type EpicType,
	type EpicStatus,
	type SubStatus,
	type TaskStatus,
} from '@specboard/db';

import type { ToolResult } from './index.ts';

export async function createItem(
	projectId: string,
	args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
	const title = args?.title as string;
	if (!title) {
		return {
			content: [{ type: 'text', text: 'title is required' }],
			isError: true,
		};
	}

	const type = (args?.type as string) || 'epic';

	if (type === 'task') {
		// Route to task creation
		const parentId = args?.parent_id as string;
		if (!parentId) {
			return {
				content: [{ type: 'text', text: 'parent_id is required when type=task' }],
				isError: true,
			};
		}

		const task = await createTaskService(projectId, parentId, {
			title,
			details: args?.description as string | undefined,
		});

		return {
			content: [
				{
					type: 'text',
					text: JSON.stringify(
						{
							created: { id: task.id, title: task.title, type: 'task', status: task.status },
							message: 'Task created',
						},
						null,
						2
					),
				},
			],
		};
	}

	// Epic/chore/bug creation
	const validTypes: EpicType[] = ['epic', 'chore', 'bug'];
	if (!validTypes.includes(type as EpicType)) {
		return {
			content: [{ type: 'text', text: 'Invalid type. Must be one of: epic, chore, bug, task' }],
			isError: true,
		};
	}

	const epic = await createEpicService(projectId, {
		title,
		type: type as EpicType,
		description: args?.description as string | undefined,
	});

	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(
					{
						created: {
							id: epic.id,
							title: epic.title,
							type: epic.type,
							status: epic.status,
						},
						message: `${type.charAt(0).toUpperCase() + type.slice(1)} created`,
					},
					null,
					2
				),
			},
		],
	};
}

export async function createItems(
	projectId: string,
	args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
	const parentId = args?.parent_id as string;
	const items = args?.items as Array<{ title: string; details?: string }>;

	if (!parentId || !items || items.length === 0) {
		return {
			content: [{ type: 'text', text: 'parent_id and items array are required' }],
			isError: true,
		};
	}

	const created = await createTasksService(projectId, parentId, items);

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

export async function updateItem(
	projectId: string,
	args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
	const itemId = args?.item_id as string;
	const type = args?.type as string;

	if (!itemId || !type) {
		return {
			content: [{ type: 'text', text: 'item_id and type are required' }],
			isError: true,
		};
	}

	if (type === 'task') {
		// Verify task belongs to project
		const taskBelongs = await verifyTaskOwnership(projectId, itemId);
		if (!taskBelongs) {
			return {
				content: [{ type: 'text', text: 'Access denied: Task does not belong to this project' }],
				isError: true,
			};
		}

		// Handle task-specific status transitions via dedicated service functions
		const status = args?.status as TaskStatus | undefined;
		const note = args?.note as string | undefined;

		if (status === 'in_progress') {
			const task = await startTaskService(itemId);
			if (!task) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
			// If note was also provided, update it separately
			if (note !== undefined) {
				await updateTaskService(itemId, { note });
			}
			return {
				content: [{ type: 'text', text: JSON.stringify({ updated: { id: task.id, status: task.status }, message: 'Task started' }, null, 2) }],
			};
		}

		if (status === 'done') {
			const task = await completeTaskService(itemId, note);
			if (!task) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
			return {
				content: [{ type: 'text', text: JSON.stringify({ updated: { id: task.id, status: task.status, note: task.note }, message: 'Task completed' }, null, 2) }],
			};
		}

		if (status === 'blocked') {
			if (!note) {
				return { content: [{ type: 'text', text: 'note is required when blocking a task' }], isError: true };
			}
			const task = await blockTaskService(itemId, note);
			if (!task) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
			return {
				content: [{ type: 'text', text: JSON.stringify({ updated: { id: task.id, status: task.status, note: task.note }, message: 'Task blocked' }, null, 2) }],
			};
		}

		if (status === 'ready' && !args?.title && !args?.description && note === undefined) {
			// Unblock shorthand (only when no other fields provided)
			const task = await unblockTaskService(itemId);
			if (!task) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
			return {
				content: [{ type: 'text', text: JSON.stringify({ updated: { id: task.id, status: task.status }, message: 'Task unblocked' }, null, 2) }],
			};
		}

		// General task update (title, details, note without status change)
		const updateData: Record<string, unknown> = {};
		if (args?.title !== undefined) updateData.title = args.title;
		if (args?.description !== undefined) updateData.details = args.description;
		if (note !== undefined) updateData.note = note;
		if (status !== undefined) updateData.status = status;

		const task = await updateTaskService(itemId, updateData);
		if (!task) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };

		return {
			content: [{ type: 'text', text: JSON.stringify({ updated: { id: task.id, title: task.title, status: task.status, note: task.note }, message: 'Task updated' }, null, 2) }],
		};
	}

	// Work item (epic/chore/bug) update
	const epicBelongs = await verifyEpicOwnership(projectId, itemId);
	if (!epicBelongs) {
		return {
			content: [{ type: 'text', text: 'Access denied: Item does not belong to this project' }],
			isError: true,
		};
	}

	const updateData: Record<string, unknown> = {};
	if (args?.title !== undefined) updateData.title = args.title;
	if (args?.description !== undefined) updateData.description = args.description;
	if (args?.status !== undefined) updateData.status = args.status as EpicStatus;
	if (args?.sub_status !== undefined) updateData.subStatus = args.sub_status as SubStatus;
	if (args?.branch_name !== undefined) updateData.branchName = args.branch_name;
	if (args?.pr_url !== undefined) updateData.prUrl = args.pr_url;
	if (args?.spec_doc_path !== undefined) {
		const rawPath = args.spec_doc_path as string;
		if (rawPath === '' || rawPath === null) {
			// Empty string or null clears the link
			updateData.specDocPath = null;
		} else {
			// Validate: must start with /, no traversal
			if (!rawPath.startsWith('/') || rawPath.includes('..')) {
				return {
					content: [{ type: 'text', text: 'Invalid spec_doc_path: must start with / and cannot contain ..' }],
					isError: true,
				};
			}
			updateData.specDocPath = rawPath;
		}
	}
	if (args?.notes !== undefined) updateData.notes = args.notes;

	const epic = await updateEpicService(projectId, itemId, updateData);
	if (!epic) {
		return {
			content: [{ type: 'text', text: 'Item not found' }],
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
							id: epic.id,
							title: epic.title,
							status: epic.status,
							subStatus: epic.subStatus,
							specDocPath: epic.specDocPath,
							branchName: epic.branchName,
							prUrl: epic.prUrl,
						},
						message: 'Item updated',
					},
					null,
					2
				),
			},
		],
	};
}

export async function deleteItem(
	projectId: string,
	args: Record<string, unknown> | undefined,
): Promise<ToolResult> {
	const itemId = args?.item_id as string;
	const type = args?.type as string;

	if (!itemId || !type) {
		return {
			content: [{ type: 'text', text: 'item_id and type are required' }],
			isError: true,
		};
	}

	if (type === 'task') {
		const taskBelongs = await verifyTaskOwnership(projectId, itemId);
		if (!taskBelongs) {
			return {
				content: [{ type: 'text', text: 'Access denied: Task does not belong to this project' }],
				isError: true,
			};
		}

		const deleted = await deleteTaskService(itemId);
		return {
			content: [{ type: 'text', text: JSON.stringify({ deleted, message: deleted ? 'Task deleted' : 'Task not found' }, null, 2) }],
			isError: !deleted,
		};
	}

	// Work item delete
	const epicBelongs = await verifyEpicOwnership(projectId, itemId);
	if (!epicBelongs) {
		return {
			content: [{ type: 'text', text: 'Access denied: Item does not belong to this project' }],
			isError: true,
		};
	}

	const deleted = await deleteEpicService(projectId, itemId);
	return {
		content: [{ type: 'text', text: JSON.stringify({ deleted, message: deleted ? 'Item deleted' : 'Item not found' }, null, 2) }],
		isError: !deleted,
	};
}
