/**
 * Planning models - Item and Task
 *
 * These models are used by the planning-web app for the kanban board.
 */

import { Model } from './Model';
import { SyncModel } from './SyncModel';
import { prop } from './prop';
import { collection } from './collection-decorator';
import type { Collection } from './Collection';
import { SyncCollection } from './SyncCollection';

/** Status type for items and tasks */
export type Status = 'ready' | 'in_progress' | 'done';

/** Sub-status for detailed work state tracking */
export type SubStatus = 'not_started' | 'scoping' | 'in_development' | 'paused' | 'needs_input' | 'pr_open' | 'complete';

/** Work item type */
export type ItemType = 'epic' | 'chore' | 'bug';

/**
 * Task model (non-syncing for now, nested within Item)
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
 * TaskStats for item progress tracking
 */
export interface TaskStats {
	total: number;
	done: number;
}

/**
 * Item model - syncs with /api/projects/:projectId/epics/:id
 */
export class ItemModel extends SyncModel {
	static override url = '/api/projects/:projectId/epics/:id';

	@prop accessor id!: string;
	@prop accessor projectId!: string;
	@prop accessor title!: string;
	@prop accessor type!: ItemType;
	@prop accessor description!: string | undefined;
	@prop accessor status!: Status;
	@prop accessor subStatus!: SubStatus;
	@prop accessor creator!: string | undefined;
	@prop accessor assignee!: string | undefined;
	@prop accessor rank!: number;
	@prop accessor specDocPath!: string | undefined;
	@prop accessor prUrl!: string | undefined;
	@prop accessor branchName!: string | undefined;
	@prop accessor createdAt!: string;
	@prop accessor updatedAt!: string;

	@collection(TaskModel) accessor tasks!: Collection<TaskModel>;

	/**
	 * Get task statistics for this item
	 */
	get taskStats(): TaskStats {
		const total = this.tasks.length;
		const done = this.tasks.filter((t) => t.status === 'done').length;
		return { total, done };
	}
}

/**
 * Collection of items - syncs with /api/projects/:projectId/epics
 *
 * @example
 * ```tsx
 * const items = new ItemsCollection();
 * items.projectId = projectId;
 * items.fetch();
 * useModel(items);
 *
 * if (items.$meta.working) return <Loading />;
 *
 * items.add({ title: 'New Item' });
 * const readyItems = items.byStatus('ready');
 * ```
 */
export class ItemsCollection extends SyncCollection<ItemModel> {
	static url = '/api/projects/:projectId/epics';
	static Model = ItemModel;

	// Note: projectId is set dynamically via constructor initialProps
	// Do NOT declare it as a class field or it will overwrite the value
	declare projectId: string;

	/**
	 * Get items filtered by status, sorted by rank.
	 */
	byStatus(status: Status): ItemModel[] {
		return this.filter((e) => e.status === status).sort((a, b) => a.rank - b.rank);
	}

	/**
	 * Get items filtered by type.
	 */
	byType(type: ItemType): ItemModel[] {
		return this.filter((e) => e.type === type);
	}
}
