/**
 * Transform functions: snake_case DB → camelCase API
 */

import type { Epic as DbEpic, Task as DbTask } from '@doc-platform/db';
import type { ApiEpic, ApiTask } from './types.js';

export function dbEpicToApi(epic: DbEpic): ApiEpic {
	return {
		id: epic.id,
		title: epic.title,
		description: epic.description ?? undefined,
		status: epic.status,
		creator: epic.creator ?? undefined,
		assignee: epic.assignee ?? undefined,
		rank: epic.rank,
		createdAt: epic.created_at.toISOString(),
		updatedAt: epic.updated_at.toISOString(),
	};
}

export function dbTaskToApi(task: DbTask): ApiTask {
	return {
		id: task.id,
		epicId: task.epic_id,
		title: task.title,
		status: task.status,
		assignee: task.assignee ?? undefined,
		dueDate: task.due_date ? new Date(task.due_date).toISOString().split('T')[0] : undefined,
		rank: task.rank,
	};
}
