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
import { fetchClient } from '@specboard/fetch';

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
 * server strips actor internals (user id, OAuth client id, MCP session id)
 * before responses reach the browser, leaving only what the UI renders.
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

/** An active agent-session episode on an item. */
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
	/** Active agent sessions on this item (detail reads only). Read-only. */
	@prop accessor workers!: ItemWorker[] | undefined;
	@prop accessor assignee!: string | undefined;
	@prop accessor rank!: number;
	@prop accessor prUrl!: string | undefined;
	@prop accessor branchName!: string | undefined;
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

/** Every status a top-level item can hold; the windows an ItemsCollection loads. */
export const ITEM_STATUSES: readonly ItemStatus[] = ['ready', 'in_progress', 'blocked', 'in_review', 'done'];

/** A list page from the API: the rows plus the total the server matched past them. */
interface StatusPage {
	status: ItemStatus;
	rows: Array<Record<string, unknown>>;
	/** Rank of the first row past the window, or undefined when the window holds the whole status. */
	boundaryRank: number | undefined;
	total: number;
}

/**
 * Collection of top-level items - syncs with /api/projects/:projectSlug/items
 *
 * Loaded as one bounded window per status (the first `limit` rows by rank, one
 * request each) rather than the whole project, so a board with thousands of items
 * stays cheap to open and to poll. Windows only grow: `loadMore` / `ensureLimit`
 * widen them, and every refetch re-requests the current width, so a poll never
 * shrinks what the user expanded. `totalFor` / `hasMore` come from the server's
 * `X-Total-Count`, which is what the views use for counts and "show more".
 *
 * @example
 * ```tsx
 * const items = new ItemsCollection({ projectSlug, limit: 100 });
 * useModel(items);
 *
 * if (items.$meta.working) return <Loading />;
 *
 * items.add({ title: 'New Item' });
 * const readyItems = items.byStatus('ready');
 * if (items.hasMore('ready')) await items.loadMore('ready', 100);
 * ```
 */
export class ItemsCollection extends SyncCollection<ItemModel> {
	static url = '/api/projects/:projectSlug/items';
	static Model = ItemModel;

	// Set dynamically via constructor initialProps — do NOT declare as class fields, or
	// the initializer would overwrite the value after the base constructor's fetch.
	declare projectSlug: string;
	/** Rows each status window starts with. */
	declare limit: number;

	// Created lazily inside load() for the same reason: the base constructor fetches
	// before a field initializer here would run, so an initializer would wipe what
	// that first request recorded.
	private declare __limits: Map<ItemStatus, number> | undefined;
	/** Per status, how many rows the server holds past what the collection has. */
	private declare __remaining: Map<ItemStatus, number> | undefined;
	/** Per status, the rank of the first row past the window (absent when the window holds it all). */
	private declare __boundaries: Map<ItemStatus, number> | undefined;
	/** Per status, the limit the last successful load was served at; rows past it are window growth, not changes. */
	private declare __served: Map<ItemStatus, number> | undefined;

	private __getLimits(): Map<ItemStatus, number> {
		if (!this.__limits) {
			if (!this.limit) throw new Error('ItemsCollection needs a limit (rows per status window)');
			this.__limits = new Map(ITEM_STATUSES.map((status) => [status, this.limit]));
		}
		return this.__limits;
	}

	/**
	 * One request per status window. Each asks for one row past its limit: that row's
	 * rank marks where the window ends, which is what tells an item this client moved
	 * or created beyond the window (still on the server, just not in the page) apart
	 * from one the server dropped. Such items are handed back to the reconcile as
	 * identity-only rows so it keeps them untouched instead of removing them. They
	 * stay until a wider window returns them for real or the page reloads; a poll
	 * cannot see another client delete or move one, since it never pages that far.
	 */
	protected override async load(): Promise<Array<Record<string, unknown>>> {
		const limits = this.__getLimits();
		const pages = await Promise.all(ITEM_STATUSES.map((status) => this.__loadPage(status, limits.get(status)!)));

		// Any page wins over a held item: the server may have moved it to another
		// status since, and the reconcile keeps the first row per key, so the full
		// rows go first and identity rows only cover keys no page returned.
		const rows: Array<Record<string, unknown>> = pages.flatMap((page) => page.rows);
		const inAnyPage = new Set(rows.map((row) => row.key));

		const remaining = new Map<ItemStatus, number>();
		const boundaries = new Map<ItemStatus, number>();
		const served = this.__served ?? new Map<ItemStatus, number>();
		for (const page of pages) {
			const beyondWindow = page.boundaryRank === undefined
				? []
				: this.filter((item) => item.status === page.status && !inAnyPage.has(item.key) && item.rank >= page.boundaryRank!);
			for (const item of beyondWindow) rows.push({ key: item.key, updatedAt: item.updatedAt });
			remaining.set(page.status, Math.max(0, page.total - page.rows.length - beyondWindow.length));
			if (page.boundaryRank !== undefined) boundaries.set(page.status, page.boundaryRank);
			// Rows past the width this status was last served at are the window
			// growing, not something the server changed: they must not flash.
			for (const row of page.rows.slice(served.get(page.status) ?? 0)) this.expectedNew.add(String(row.key));
			served.set(page.status, limits.get(page.status)!);
		}
		this.__remaining = remaining;
		this.__boundaries = boundaries;
		this.__served = served;
		return rows;
	}

	private async __loadPage(status: ItemStatus, limit: number): Promise<StatusPage> {
		const { data, headers } = await fetchClient.getResponse<Array<Record<string, unknown>>>(
			`${this.getUrl()}?status=${status}&limit=${limit + 1}`
		);
		const rows = data.slice(0, limit);
		const boundary = data[limit];
		// A missing or unparseable header degrades to "everything loaded" (the page
		// alone) rather than to a count that includes the boundary row.
		const header = headers.get('X-Total-Count');
		const parsed = header === null ? Number.NaN : Number(header);
		const total = Number.isFinite(parsed) ? parsed : rows.length;
		return { status, rows, boundaryRank: boundary ? Number(boundary.rank) : undefined, total };
	}

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

	/** How many items in this status the collection holds (a count, no sorting). */
	loadedFor(status: ItemStatus): number {
		let count = 0;
		for (const item of this) if (item.status === status) count++;
		return count;
	}

	/**
	 * How many items the project holds in this status: what is loaded plus what the
	 * server reported past the window. Tracks local adds, removes, and moves at once,
	 * since those change the loaded part and leave the remainder alone.
	 */
	totalFor(status: ItemStatus): number {
		return this.loadedFor(status) + (this.__remaining?.get(status) ?? 0);
	}

	/** Whether the server holds items in this status past the loaded window. */
	hasMore(status: ItemStatus): boolean {
		return (this.__remaining?.get(status) ?? 0) > 0;
	}

	/**
	 * Rank of the first item past this status's window, or undefined when the window
	 * holds the whole status. A locally re-ranked item must sort at or past it to
	 * survive the next poll (see load), so "the end of the column" starts here.
	 */
	firstUnloadedRank(status: ItemStatus): number | undefined {
		return this.__boundaries?.get(status);
	}

	/** Widen one status window by `count` rows and refetch. The rows it adds are not flashed. */
	async loadMore(status: ItemStatus, count: number): Promise<void> {
		const limits = this.__getLimits();
		limits.set(status, limits.get(status)! + count);
		await this.fetch({ force: true });
	}

	/**
	 * Make every window at least `limit` rows wide. Refetches only when that can
	 * change anything: some status has rows past its window, or the first load is
	 * still in flight (it went out at the old width; `force` waits for it and then
	 * re-requests at the new one). Used when a view with a larger page size takes
	 * over the collection.
	 */
	async ensureLimit(limit: number): Promise<void> {
		const limits = this.__getLimits();
		let grew = false;
		let hasMore = false;
		for (const status of ITEM_STATUSES) {
			if (limits.get(status)! >= limit) continue;
			limits.set(status, limit);
			grew = true;
			if (this.hasMore(status)) hasMore = true;
		}
		if (grew && (hasMore || this.$meta.lastFetched == null)) {
			await this.fetch({ force: true });
		}
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

/**
 * Activity-log entry — one appended note on an item. Entries are never edited
 * or deleted, so this model only ever reads or POSTs.
 * Syncs with /api/projects/:projectSlug/items/:itemKey/notes/:id
 */
export class NoteModel extends SyncModel {
	static override url = '/api/projects/:projectSlug/items/:itemKey/notes/:id';

	@prop accessor id!: string;
	@prop accessor projectSlug!: string;
	@prop accessor itemKey!: string;
	@prop accessor note!: string;
	/** Who wrote the entry. Null on entries that predate actor capture. Read-only. */
	@prop accessor actor!: Actor | null;
	@prop accessor createdAt!: string;
}

/**
 * Activity log for one item, newest first as the server returns it.
 * Syncs with /api/projects/:projectSlug/items/:itemKey/notes
 *
 * add({ note }) appends an entry; there is no remove — the log is append-only.
 * Entries are immutable, so `createdAt` stands in for `updatedAt` as the
 * change key that a reconciling fetch compares.
 */
export class NotesCollection extends SyncCollection<NoteModel> {
	static url = '/api/projects/:projectSlug/items/:itemKey/notes';
	static Model = NoteModel;
	static changeKey = 'createdAt';

	// Set dynamically via constructor initialProps — do NOT declare as class fields.
	declare projectSlug: string;
	declare itemKey: string;
}
