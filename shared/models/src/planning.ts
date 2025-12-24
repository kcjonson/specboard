/**
 * Planning models - Epic and Task
 *
 * These models are used by the planning-web app for the kanban board.
 */

import { Model } from './Model';
import { prop } from './prop';
import { collection } from './collection-decorator';
import type { Collection } from './Collection';
import { createCollection } from './Collection';
import type { ModelData } from './types';

/** Status type for epics and tasks */
export type Status = 'ready' | 'in_progress' | 'done';

/**
 * Task model
 */
export class TaskModel extends Model {
	@prop accessor id!: string;
	@prop accessor epicId!: string;
	@prop accessor title!: string;
	@prop accessor status!: Status;
	@prop accessor assignee!: string | undefined;
	@prop accessor dueDate!: string | undefined;
	@prop accessor rank!: number;
}

/**
 * TaskStats for epic progress tracking
 */
export interface TaskStats {
	total: number;
	done: number;
}

/**
 * Epic model with nested tasks collection
 */
export class EpicModel extends Model {
	@prop accessor id!: string;
	@prop accessor title!: string;
	@prop accessor description!: string | undefined;
	@prop accessor status!: Status;
	@prop accessor assignee!: string | undefined;
	@prop accessor rank!: number;
	@prop accessor createdAt!: string;
	@prop accessor updatedAt!: string;

	@collection(TaskModel) accessor tasks!: Collection<TaskModel>;

	/**
	 * Get task statistics for this epic
	 */
	get taskStats(): TaskStats {
		const total = this.tasks.length;
		const done = this.tasks.filter((t) => t.status === 'done').length;
		return { total, done };
	}
}

/**
 * Create a collection of epics for the board
 */
export function createEpicsCollection(
	initialData?: Array<Partial<ModelData<EpicModel>>>
): Collection<EpicModel> {
	return createCollection(EpicModel, initialData as Array<Record<string, unknown>>);
}
