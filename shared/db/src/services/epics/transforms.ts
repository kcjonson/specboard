/**
 * Epic service transform/helper functions
 */

import type { Epic, Task, ProgressNote } from '../../types.ts';
import type { EpicResponse, TaskSummary, ProgressNoteSummary, TaskStats } from './types.ts';

export function transformEpic(epic: Epic): Omit<EpicResponse, 'taskStats'> {
	return {
		id: epic.id,
		title: epic.title,
		type: epic.type,
		description: epic.description,
		status: epic.status,
		subStatus: epic.sub_status,
		creator: epic.creator,
		rank: epic.rank,
		specDocPath: epic.spec_doc_path,
		prUrl: epic.pr_url,
		branchName: epic.branch_name,
		notes: epic.notes,
		createdAt: epic.created_at,
		updatedAt: epic.updated_at,
	};
}

export function transformTask(task: Task): TaskSummary {
	return {
		id: task.id,
		title: task.title,
		status: task.status,
		details: task.details,
		note: task.note,
	};
}

export function transformProgressNote(note: ProgressNote): ProgressNoteSummary {
	return {
		id: note.id,
		note: note.note,
		createdBy: note.created_by,
		createdAt: note.created_at,
	};
}

export function calculateTaskStats(tasks: Task[]): TaskStats {
	return {
		total: tasks.length,
		done: tasks.filter((t) => t.status === 'done').length,
		inProgress: tasks.filter((t) => t.status === 'in_progress').length,
		blocked: tasks.filter((t) => t.status === 'blocked').length,
	};
}
