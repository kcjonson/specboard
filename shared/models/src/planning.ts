/**
 * Planning models - Epic and Task
 *
 * These models are used by the planning-web app for the kanban board.
 */

import { Model } from './Model';
import { SyncModel } from './SyncModel';
import { prop } from './prop';
import { collection } from './collection-decorator';
import type { Collection } from './Collection';
import { SyncCollection } from './SyncCollection';

/** Status type for epics and tasks */
export type Status = 'ready' | 'in_progress' | 'done';

/**
 * Task model (non-syncing for now, nested within Epic)
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
 * Epic model - syncs with /api/epics/:id
 */
export class EpicModel extends SyncModel {
	static override url = '/api/epics/:id';

	@prop accessor id!: string;
	@prop accessor title!: string;
	@prop accessor description!: string | undefined;
	@prop accessor status!: Status;
	@prop accessor creator!: string | undefined;
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
 * Collection of epics - syncs with /api/epics
 * Auto-fetches on construction.
 *
 * @example
 * ```tsx
 * const epics = new EpicsCollection();
 * useModel(epics);
 *
 * if (epics.$meta.working) return <Loading />;
 *
 * epics.add({ title: 'New Epic' });
 * const readyEpics = epics.byStatus('ready');
 * ```
 */
export class EpicsCollection extends SyncCollection<EpicModel> {
	static url = '/api/epics';
	static Model = EpicModel;

	/**
	 * Get epics filtered by status, sorted by rank.
	 */
	byStatus(status: Status): EpicModel[] {
		return this.filter((e) => e.status === status).sort((a, b) => a.rank - b.rank);
	}
}
