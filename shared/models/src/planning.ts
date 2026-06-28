/**
 * Planning models - Item and its child summaries
 *
 * These models are used by the planning-web app for the kanban board.
 */

import { Model } from './Model';
import { SyncModel } from './SyncModel';
import { prop } from './prop';
import { collection } from './collection-decorator';
import type { Collection } from './Collection';
import { SyncCollection } from './SyncCollection';
import type { ModelData } from './types';

/** Board status columns */
export type Status = 'ready' | 'in_progress' | 'done';

/** Full item status (children may be blocked; epics may be in_review) */
export type ItemStatus = 'ready' | 'in_progress' | 'blocked' | 'in_review' | 'done';

/** Sub-status for detailed work state tracking */
export type SubStatus = 'not_started' | 'scoping' | 'in_development' | 'paused' | 'needs_input' | 'pr_open' | 'complete';

/** Item type */
export type ItemType = 'epic' | 'task' | 'bug';

/** Spec link type */
export type SpecType = 'product' | 'technical';

/**
 * Child summary — a nested item as returned in an item's `children` array.
 * Display-only; edit a child by loading it as a full ItemModel.
 */
export class ChildModel extends Model {
	@prop accessor id!: string;
	@prop accessor type!: ItemType;
	@prop accessor title!: string;
	@prop accessor status!: ItemStatus;
	@prop accessor description!: string | undefined;
	@prop accessor note!: string | undefined;
}

/**
 * Child-count stats for an item.
 */
export interface ChildStats {
	total: number;
	done: number;
}

/**
 * Item model - syncs with /api/projects/:projectId/items/:id
 */
export class ItemModel extends SyncModel {
	static override url = '/api/projects/:projectId/items/:id';

	@prop accessor id!: string;
	@prop accessor projectId!: string;
	@prop accessor parentId!: string | undefined;
	@prop accessor title!: string;
	@prop accessor type!: ItemType;
	@prop accessor description!: string | undefined;
	@prop accessor status!: ItemStatus;
	@prop accessor subStatus!: SubStatus | undefined;
	@prop accessor creator!: string | undefined;
	@prop accessor assignee!: string | undefined;
	@prop accessor rank!: number;
	@prop accessor prUrl!: string | undefined;
	@prop accessor branchName!: string | undefined;
	@prop accessor note!: string | undefined;
	@prop accessor createdAt!: string;
	@prop accessor updatedAt!: string;

	/**
	 * Child counts from the server (list + detail endpoints) under the API key
	 * `childStats`. Used to show progress and decide expandability before an
	 * item's children are individually loaded. Remapped from `childStats` on
	 * input (see remapChildStats) so it doesn't collide with the childStats getter.
	 */
	@prop accessor childStatsSummary!: ChildStats | undefined;

	@collection(ChildModel) accessor children!: Collection<ChildModel>;

	constructor(initialData?: Record<string, unknown>) {
		super(ItemModel.remapChildStats(initialData));
	}

	override set(data: Partial<ModelData<this>>): void;
	override set<K extends keyof ModelData<this>>(property: K, value: ModelData<this>[K]): void;
	override set(
		dataOrProperty: Partial<ModelData<this>> | keyof ModelData<this>,
		value?: unknown
	): void {
		if (typeof dataOrProperty === 'object' && dataOrProperty !== null) {
			super.set(ItemModel.remapChildStats(dataOrProperty as Record<string, unknown>) as Partial<ModelData<this>>);
		} else {
			super.set(dataOrProperty as keyof ModelData<this>, value as ModelData<this>[keyof ModelData<this>]);
		}
	}

	/**
	 * Move the server `childStats` payload key onto `childStatsSummary`. The model
	 * exposes `childStats` as a computed getter, so the raw server counts need a
	 * separate backing field to survive ingestion.
	 */
	private static remapChildStats(
		data?: Record<string, unknown>
	): Record<string, unknown> | undefined {
		if (!data || typeof data !== 'object' || !('childStats' in data)) {
			return data;
		}
		const { childStats, ...rest } = data;
		return { ...rest, childStatsSummary: childStats };
	}

	/**
	 * Child statistics for this item. Prefers live counts when children are loaded
	 * (so in-session edits are reflected immediately); otherwise falls back to the
	 * server-provided summary from the list endpoint.
	 */
	get childStats(): ChildStats {
		if (this.children.length > 0) {
			const total = this.children.length;
			const done = this.children.filter((c) => c.status === 'done').length;
			return { total, done };
		}
		return this.childStatsSummary ?? { total: 0, done: 0 };
	}
}

/**
 * Collection of top-level items - syncs with /api/projects/:projectId/items
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
	static url = '/api/projects/:projectId/items';
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

/**
 * Spec link model — a typed link from an item to a markdown spec document.
 * Syncs with /api/projects/:projectId/items/:itemId/specs/:id
 */
export class SpecModel extends SyncModel {
	static override url = '/api/projects/:projectId/items/:itemId/specs/:id';

	@prop accessor id!: string;
	@prop accessor projectId!: string;
	@prop accessor itemId!: string;
	@prop accessor path!: string;
	@prop accessor type!: SpecType;
	@prop accessor createdAt!: string;
}

/**
 * Collection of spec links for one item.
 * Syncs with /api/projects/:projectId/items/:itemId/specs
 *
 * @example
 * ```tsx
 * const specs = new SpecsCollection({ projectId, itemId });
 * useModel(specs);
 * await specs.add({ path: '/docs/specs/x.md', type: 'product' }); // POSTs
 * await specs.remove(spec); // DELETEs
 * ```
 */
export class SpecsCollection extends SyncCollection<SpecModel> {
	static url = '/api/projects/:projectId/items/:itemId/specs';
	static Model = SpecModel;

	// Set dynamically via constructor initialProps — do NOT declare as class fields.
	declare projectId: string;
	declare itemId: string;
}
