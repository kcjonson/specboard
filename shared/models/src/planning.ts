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

/**
 * State of one checklist entry. Deliberately a union rather than a boolean: more
 * states are expected, and a boolean cannot grow into them without an API break.
 */
export type ChecklistStatus = 'todo' | 'done';

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
	// null from the API for a top-level item, undefined before the field is set.
	// Model.set stores what it is given, so the type has to admit both.
	@prop accessor parentId!: string | null | undefined;
	/**
	 * Key of the item this one hangs under, absent on a top-level item. Set it when
	 * creating a child; the list endpoint also sends it on the child rows a search
	 * matches, which is how a view knows to label where the item lives.
	 */
	@prop accessor parentKey!: string | null | undefined;
	/** Title of the parent item, absent on a top-level item. Read-only; joined by the server. */
	@prop accessor parentTitle!: string | null | undefined;
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

	/**
	 * Reparent this item, or promote it to top-level with null. There is no
	 * "leave unchanged": the route takes the destination, and null is a destination.
	 *
	 * Assigning `parentKey` and saving does nothing — the PUT handler picks a fixed
	 * set of fields off the body and drops the rest — so this route is the only path.
	 * The server re-ranks the item to the bottom of its new sibling group and rejects
	 * a move that would close a cycle, which is why nothing is checked here first.
	 */
	async move(parentKey: string | null): Promise<void> {
		this.setMeta({ working: true, error: null });
		try {
			const result = await fetchClient.post<Record<string, unknown>>(`${this.buildUrl()}/move`, { parentKey });
			this.set(result as Partial<ModelData<this>>);
			this.setMeta({ working: false });
		} catch (error) {
			this.setMeta({
				working: false,
				error: error instanceof Error ? error : new Error(String(error)),
			});
			throw error;
		}
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
 * Server-side filter on the windows a collection loads. Both fields narrow every
 * status window; `type` matches an item's own type, and a non-empty `search` also
 * matches items at any depth, so child rows (which carry `parentKey`) come back too.
 */
export interface ItemsFilter {
	/** Free text; the server matches it against title, description, and item key. */
	search?: string;
	/** One item type, or undefined for all of them. */
	type?: ItemType;
}

/** The filter as the query string carries it: trimmed search, no undefined-vs-empty ambiguity. */
function normalizeFilter(filter: ItemsFilter | undefined): { search: string; type: ItemType | undefined } {
	return { search: filter?.search?.trim() ?? '', type: filter?.type };
}

/**
 * Collection of items - syncs with /api/projects/:projectSlug/items
 *
 * Loaded as one bounded window per status (the first `limit` rows by rank, one
 * request each) rather than the whole project, so a board with thousands of items
 * stays cheap to open and to poll. Windows only grow: `loadMore` / `ensureLimit`
 * widen them, and every refetch re-requests the current width, so a poll never
 * shrinks what the user expanded. `totalFor` / `hasMore` come from the server's
 * `X-Total-Count`, which is what the views use for counts and "show more".
 *
 * Filtering is the server's job, not the caller's: `setFilter` puts `search=` /
 * `type=` on every window request, and `X-Total-Count` comes back narrowed to
 * match. A filter change is a different question rather than a wider window, so
 * it starts the windows over at `limit` (see setFilter).
 *
 * @example
 * ```tsx
 * const items = new ItemsCollection({ projectSlug, limit: 100 });
 * useModel(items);
 *
 * if (items.$meta.working) return <Loading />;
 *
 * items.add({ title: 'New Item' });
 * await items.setFilter({ search: 'oauth', type: 'bug' });
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
	/**
	 * Server-side filter on every window request; `setFilter` is the only way in.
	 * Deliberately not named `filter`, which is the collection's own array method.
	 */
	private declare __filter: ItemsFilter | undefined;

	/**
	 * Which query the windows belong to, bumped by every filter change. A response
	 * that resolves against an older one is answering a question the user has left,
	 * so `load` discards it (see there).
	 */
	private declare __generation: number | undefined;

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
		const generation = this.__generation ?? 0;
		// A copy, not the live map: a loadMore/ensureLimit landing while these requests
		// are out widens it, and recording the wider width as served would make the next
		// load read rows it never got as unchanged — and flash them when they arrive.
		const limits = new Map(this.__getLimits());
		const pages = await Promise.all(ITEM_STATUSES.map((status) => this.__loadPage(status, limits.get(status)!)));

		// A response to a query the user has already typed past ("ab" landing after
		// "abc" went out) answers the wrong question, rows and window bookkeeping
		// alike. Identity rows for what is loaded are the reconcile's "change
		// nothing" input, so the collection holds still until the refetch that the
		// filter change queued brings the real answer.
		if (generation !== (this.__generation ?? 0)) {
			return this.map((item) => ({ key: item.key, updatedAt: item.updatedAt }));
		}

		// Any page wins over a held item: the server may have moved it to another
		// status since, and the reconcile keeps the first row per key, so the full
		// rows go first and identity rows only cover keys no page returned.
		const rows: Array<Record<string, unknown>> = pages.flatMap((page) => page.rows);
		const inAnyPage = new Set(rows.map((row) => row.key));

		const remaining = new Map<ItemStatus, number>();
		const boundaries = new Map<ItemStatus, number>();
		const served = this.__served ?? new Map<ItemStatus, number>();
		for (const page of pages) {
			// Nothing is held past a window this query has not served yet: whatever sits
			// out there was put there by the previous question and may not even match
			// this one, so a filter change (which clears `served`) lets it go.
			const beyondWindow = page.boundaryRank === undefined || served.get(page.status) === undefined
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

	/**
	 * One status window's query string. The extra row past `limit` is the window
	 * boundary (see load); the filter params are omitted when they hold nothing,
	 * so an unfiltered board issues exactly the request it always did.
	 */
	private __pageUrl(status: ItemStatus, limit: number): string {
		const params = new URLSearchParams({ status, limit: String(limit + 1) });
		const { search, type } = normalizeFilter(this.__filter);
		if (search) params.set('search', search);
		if (type) params.set('type', type);
		return `${this.getUrl()}?${params.toString()}`;
	}

	private async __loadPage(status: ItemStatus, limit: number): Promise<StatusPage> {
		const { data, headers } = await fetchClient.getResponse<Array<Record<string, unknown>>>(
			this.__pageUrl(status, limit)
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

	/**
	 * Whether a search or type filter is narrowing the windows. Views need it
	 * because an item's own `children` are always the unfiltered set, so anything
	 * that renders them next to the filtered rows (the table's expand) has to stand
	 * down while this is true. A type filter alone still returns top-level items; a
	 * non-empty search also returns matched children as rows of their own, which is
	 * the case where expanding would show the same item twice.
	 */
	get filterActive(): boolean {
		const { search, type } = normalizeFilter(this.__filter);
		return search !== '' || type !== undefined;
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

	/**
	 * Point the collection at a different query. Unlike a widened window this is not
	 * more of what is loaded, so every window starts over at the base `limit` and the
	 * bookkeeping of the old query goes with it — including the items it was holding
	 * past its windows, which have no standing under a filter they may not even match.
	 * Callers debounce free text; a no-op change (the same trimmed search and type)
	 * doesn't refetch, which is what keeps a keystroke-per-render caller cheap.
	 */
	async setFilter(filter: ItemsFilter): Promise<void> {
		const next = normalizeFilter(filter);
		const current = normalizeFilter(this.__filter);
		if (next.search === current.search && next.type === current.type) return;

		this.__filter = next;
		this.__generation = (this.__generation ?? 0) + 1;
		this.__limits = undefined;
		this.__remaining = undefined;
		this.__boundaries = undefined;
		this.__served = undefined;
		await this.fetch({ force: true });
	}

	/** Widen one status window by `count` rows and refetch. The rows it adds are not flashed. */
	async loadMore(status: ItemStatus, count: number): Promise<void> {
		const limits = this.__getLimits();
		limits.set(status, limits.get(status)! + count);
		await this.fetch({ force: true });
	}

	/**
	 * Make every window at least `limit` rows wide, now and for the windows any later
	 * query starts with. Refetches only when that can change anything: some status has
	 * rows past its window, or the first load is still in flight (it went out at the
	 * old width; `force` waits for it and then re-requests at the new one). Used when
	 * a view with a larger page size takes over the collection.
	 */
	async ensureLimit(limit: number): Promise<void> {
		const limits = this.__getLimits();
		// A floor for the collection, not just for the windows it holds now: a later
		// filter change starts its windows over at `limit`, and the view that asked
		// for this width still needs it.
		this.limit = Math.max(this.limit, limit);
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
 * Checklist entry — one scratch todo on an item: text and a status, nothing
 * more. Deliberately not a child item: no key, no status, no history.
 * Syncs with /api/projects/:projectSlug/items/:itemKey/checklist/:id
 */
export class ChecklistEntryModel extends SyncModel {
	static override url = '/api/projects/:projectSlug/items/:itemKey/checklist/:id';

	@prop accessor id!: string;
	@prop accessor projectSlug!: string;
	@prop accessor itemKey!: string;
	@prop accessor text!: string;
	@prop accessor status!: ChecklistStatus;

	/**
	 * Write ONLY the named fields. save() would PUT the whole model, so a status
	 * toggle would carry this client's copy of `text` and overwrite a rename made
	 * somewhere else in between — the exact clobbering the sub-resource exists to
	 * avoid. The handler patches whatever it is sent, so sending one field changes
	 * one field.
	 */
	async patch(fields: Partial<Pick<ChecklistEntryData, 'text' | 'status'>>): Promise<void> {
		const result = await fetchClient.put<Record<string, unknown>>(this.buildUrl(), fields);
		this.set(result as Partial<ModelData<this>>);
	}
}

/** The writable fields of a checklist entry. */
interface ChecklistEntryData {
	text: string;
	status: ChecklistStatus;
}

/**
 * An item's checklist, in display order.
 * Syncs with /api/projects/:projectSlug/items/:itemKey/checklist
 *
 * add({ text }) appends an entry; entry.patch({ status }) or entry.patch({ text })
 * writes that ONE field of that ONE entry (the server rewrites only the matched
 * element, so ticking one box can't clobber a concurrent edit to a different
 * one); remove(entry) deletes it. Do NOT reach for entry.save() here: it PUTs
 * the whole model, so a tick would carry this client's copy of the text and
 * overwrite a rename made in between.
 * There is no checklist prop on ItemModel for the same reason: SyncModel.save()
 * PUTs the whole model, so the array would ride along on every title or status
 * edit and overwrite whatever an agent wrote in between.
 */
export class ChecklistCollection extends SyncCollection<ChecklistEntryModel> {
	static url = '/api/projects/:projectSlug/items/:itemKey/checklist';
	static Model = ChecklistEntryModel;

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
