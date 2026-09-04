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
 * Who or what performed an action (creation provenance, worker episodes).
 * This is the API's SANITIZED view, not the server's full Actor union: the
 * server strips actor internals (user id, OAuth client id) before responses
 * reach the browser, leaving only what the UI renders.
 */
export interface Actor {
	type: 'user' | 'agent' | 'system';
	deviceName?: string;
	client?: { name: string; version?: string };
}

/** Immutable creation provenance on an item. */
export interface ItemOrigin {
	actor: Actor;
	discoveredFrom?: { itemId: string; itemKey: string };
}

/** An active agent-client episode on an item. */
export interface ItemWorker {
	id: string;
	actor: Actor;
	branch: string | null;
	startedAt: string;
	lastSeenAt: string;
}

/**
 * Child summary — a nested item as returned in an item's `children` array.
 * Display-only; edit a child by loading it as a full ItemModel.
 */
export class ChildModel extends Model {
	@prop accessor id!: string;
	/** The child's address, `<project key>-<number>` (e.g. SB-346). */
	@prop accessor key!: string;
	@prop accessor number!: number;
	@prop accessor type!: ItemType;
	@prop accessor title!: string;
	@prop accessor status!: ItemStatus;
	/** Derived server-side: status is 'blocked' OR an open blocker exists. */
	@prop accessor blocked!: boolean | undefined;
	@prop accessor description!: string | undefined;
	@prop accessor note!: string | undefined;
}

/**
 * Child-count stats for an item.
 */
export interface ChildStats {
	total: number;
	done: number;
	blocked: number;
}

/**
 * Item model - syncs with /api/projects/:projectSlug/items/:key
 *
 * Items are addressed by key (`SB-345`), so `key` is the model's id field: a model
 * without one is new and saves with POST. `id` is the server's internal UUID, carried
 * for reference but never used to build URLs; `projectSlug` comes from the collection's
 * URL params (or is passed in for a standalone model) and addresses the project.
 */
export class ItemModel extends SyncModel {
	static override url = '/api/projects/:projectSlug/items/:key';
	static override idField = 'key';

	@prop accessor id!: string;
	/** The item's address, `<project key>-<number>` (e.g. SB-345). */
	@prop accessor key!: string;
	@prop accessor number!: number;
	@prop accessor projectSlug!: string;
	@prop accessor parentId!: string | undefined;
	/** Key of the parent to nest under. Write-only: set it when creating a child. */
	@prop accessor parentKey!: string | undefined;
	@prop accessor title!: string;
	@prop accessor type!: ItemType;
	@prop accessor description!: string | undefined;
	@prop accessor status!: ItemStatus;
	@prop accessor subStatus!: SubStatus | undefined;
	/** Derived server-side: status is 'blocked' OR an open blocker exists. Read-only. */
	@prop accessor blocked!: boolean | undefined;
	/** Immutable creation provenance. Read-only; the server never accepts it on writes. */
	@prop accessor origin!: ItemOrigin | undefined;
	/** Active agent clients on this item (detail reads only). Read-only. */
	@prop accessor workers!: ItemWorker[] | undefined;
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
			const blocked = this.children.filter((c) => c.blocked ?? c.status === 'blocked').length;
			return { total, done, blocked };
		}
		return this.childStatsSummary ?? { total: 0, done: 0, blocked: 0 };
	}
}

/**
 * Collection of top-level items - syncs with /api/projects/:projectSlug/items?limit=1000
 *
 * @example
 * ```tsx
 * const items = new ItemsCollection();
 * items.projectSlug = projectSlug;
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
	// limit=1000 is the server's max; without it the API caps the list at 500,
	// which silently hides items on large boards. Real pagination is tracked
	// separately.
	static url = '/api/projects/:projectSlug/items?limit=1000';
	static Model = ItemModel;

	// Note: projectSlug is set dynamically via constructor initialProps
	// Do NOT declare it as a class field or it will overwrite the value
	declare projectSlug: string;

	/**
	 * Get items filtered by status, sorted by rank.
	 */
	byStatus(status: ItemStatus): ItemModel[] {
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
 * Syncs with /api/projects/:projectSlug/items/:itemKey/specs/:id
 */
export class SpecModel extends SyncModel {
	static override url = '/api/projects/:projectSlug/items/:itemKey/specs/:id';

	@prop accessor id!: string;
	@prop accessor projectSlug!: string;
	@prop accessor itemKey!: string;
	@prop accessor path!: string;
	@prop accessor type!: SpecType;
	@prop accessor createdAt!: string;
}

/**
 * Collection of spec links for one item.
 * Syncs with /api/projects/:projectSlug/items/:itemKey/specs
 *
 * @example
 * ```tsx
 * const specs = new SpecsCollection({ projectSlug, itemKey });
 * useModel(specs);
 * await specs.add({ path: '/docs/specs/x.md', type: 'product' }); // POSTs
 * await specs.remove(spec); // DELETEs
 * ```
 */
export class SpecsCollection extends SyncCollection<SpecModel> {
	static url = '/api/projects/:projectSlug/items/:itemKey/specs';
	static Model = SpecModel;

	// Set dynamically via constructor initialProps — do NOT declare as class fields.
	declare projectSlug: string;
	declare itemKey: string;
}

/**
 * Blocker model — one blocked-by row on an item: another item ({ itemKey }) XOR
 * free text ({ text }). Syncs with /api/projects/:projectSlug/items/:itemKey/blockers/:id
 */
export class BlockerModel extends SyncModel {
	static override url = '/api/projects/:projectSlug/items/:itemKey/blockers/:id';

	@prop accessor id!: string;
	@prop accessor projectSlug!: string;
	@prop accessor itemKey!: string;
	@prop accessor type!: 'item' | 'text';
	@prop accessor text!: string | undefined;
	/** Key/title/status of the blocking item (item blockers only). Named blocker* so they can't collide with the URL's :itemKey. */
	@prop accessor blockerKey!: string | undefined;
	@prop accessor blockerTitle!: string | undefined;
	@prop accessor blockerStatus!: ItemStatus | undefined;
	@prop accessor createdAt!: string;
	@prop accessor clearedAt!: string | undefined;
}

/**
 * Collection of open blockers for one item.
 * Syncs with /api/projects/:projectSlug/items/:itemKey/blockers
 *
 * add({ blockerKey }) blocks on another item; add({ text }) records a written
 * reason. remove(blocker) clears it (the server tombstones, never deletes).
 */
export class BlockersCollection extends SyncCollection<BlockerModel> {
	static url = '/api/projects/:projectSlug/items/:itemKey/blockers';
	static Model = BlockerModel;

	// Set dynamically via constructor initialProps — do NOT declare as class fields.
	declare projectSlug: string;
	declare itemKey: string;
}
