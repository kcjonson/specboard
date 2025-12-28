/**
 * Transform functions: snake_case DB → camelCase API
 */

import type { Epic as DbEpic, Task as DbTask, ProgressNote as DbProgressNote, Project as DbProject } from '@doc-platform/db';
import type { ApiEpic, ApiTask, ApiProgressNote, ApiProject } from './types.js';

export function dbEpicToApi(epic: DbEpic): ApiEpic {
	return {
		id: epic.id,
		title: epic.title,
		description: epic.description ?? undefined,
		status: epic.status,
		creator: epic.creator ?? undefined,
		assignee: epic.assignee ?? undefined,
		rank: epic.rank,
		specDocPath: epic.spec_doc_path ?? undefined,
		prUrl: epic.pr_url ?? undefined,
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
		details: task.details ?? undefined,
		blockReason: task.block_reason ?? undefined,
	};
}

export function dbProgressNoteToApi(note: DbProgressNote): ApiProgressNote {
	return {
		id: note.id,
		epicId: note.epic_id ?? undefined,
		taskId: note.task_id ?? undefined,
		note: note.note,
		createdBy: note.created_by ?? undefined,
		createdAt: note.created_at.toISOString(),
	};
}

export function dbProjectToApi(project: DbProject): ApiProject {
	return {
		id: project.id,
		name: project.name,
		description: project.description ?? undefined,
		ownerId: project.owner_id,
		createdAt: project.created_at.toISOString(),
		updatedAt: project.updated_at.toISOString(),
	};
}
