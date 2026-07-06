/**
 * @specboard/models - SyncCollection
 *
 * A collection that syncs with a REST API.
 * Auto-fetches on construction, items are SyncModels.
 *
 * @example
 * ```typescript
 * class ItemsCollection extends SyncCollection<ItemModel> {
 *   static url = '/api/items';
 *   static Model = ItemModel;
 *
 *   byStatus(status: Status): ItemModel[] {
 *     return this.filter((e) => e.status === status);
 *   }
 * }
 *
 * const items = new ItemsCollection(); // Auto-fetches
 * items.$meta.working // true while loading
 * items[0] // index access works
 * items.byStatus('ready') // custom methods work
 * ```
 */

import { fetchClient } from '@specboard/fetch';
import type { SyncModel } from './SyncModel';
import { COLLECTIONS } from './collection-decorator';
import type { ChangeCallback, Observable, ModelData } from './types';

/** Constructor for SyncModel subclasses */
export interface SyncModelConstructor<T extends SyncModel> {
	url: string;
	idField?: string;
	new (initialData?: Record<string, unknown>): T;
}

/** Collection metadata */
export interface CollectionMeta {
	working: boolean;
	error: Error | null;
	lastFetched: number | null;
}

/**
 * SyncCollection - a collection that syncs with a REST API.
 *
 * Extend this class and set static `url` and `Model` properties.
 * The constructor returns a Proxy that enables array index access.
 */
export class SyncCollection<T extends SyncModel> implements Observable {
	/** URL for the collection endpoint */
	static url: string = '';

	/** The SyncModel class for items */
	static Model: SyncModelConstructor<SyncModel>;

	/**
	 * Field used to detect that the server changed an item during a reconciling
	 * fetch. When present on both the existing model and the incoming payload, a
	 * differing value marks the item as changed (drives the `itemsChanged` event).
	 * Models without this field are always re-applied but never reported as changed.
	 */
	static changeKey: string = 'updatedAt';

	/** Internal storage */
	private __items: T[] = [];

	/** Event listeners */
	private __listeners: Record<string, ChangeCallback[]> = {};

	/** Listeners for the ids reported changed by a (non-initial) reconciling fetch. */
	private __itemsChangedListeners: Array<(ids: string[]) => void> = [];

	/**
	 * The in-flight fetch, if any. Concurrent callers (poll tick + focus refresh +
	 * manual refresh) share it rather than each starting their own reconcile, so
	 * refetches can't complete out of order and roll the collection back to stale data.
	 */
	private __fetchInFlight: Promise<void> | null = null;

	/**
	 * Bumped on every change emit (add/remove/item mutation). Lets memoized derived
	 * state (e.g. status grouping) recompute on in-place mutations even though the
	 * collection reference is stable — include `version` in the memo deps.
	 */
	private __version = 0;

	/** Collection metadata */
	readonly $meta: CollectionMeta = {
		working: false,
		error: null,
		lastFetched: null,
	};

	constructor(initialProps?: Record<string, unknown>) {
		// Set initial properties (e.g., projectId) before auto-fetch
		if (initialProps) {
			Object.assign(this, initialProps);
		}

		// Auto-fetch after properties are set
		this.fetch();

		// Return a Proxy that enables array index access (e.g., collection[0])
		return new Proxy(this, {
			get(target, prop, receiver) {
				if (typeof prop === 'string' && /^\d+$/.test(prop)) {
					return target.__items[parseInt(prop, 10)];
				}
				return Reflect.get(target, prop, receiver);
			},
			set(target, prop, value, receiver) {
				if (typeof prop === 'string' && /^\d+$/.test(prop)) {
					throw new Error(
						'Cannot replace collection items by index. Use add() or modify item properties directly.'
					);
				}
				return Reflect.set(target, prop, value, receiver);
			},
		});
	}

	/** Get the Model class from static property */
	private getModelClass(): SyncModelConstructor<T> {
		return (this.constructor as typeof SyncCollection).Model as SyncModelConstructor<T>;
	}

	/** Get the URL, substituting params from instance properties */
	private getUrl(): string {
		const template = (this.constructor as typeof SyncCollection).url;
		return template.replace(/:(\w+)/g, (_, key) => {
			const value = (this as Record<string, unknown>)[key];
			if (value === undefined) {
				throw new Error(`Missing URL param "${key}" on ${this.constructor.name}`);
			}
			return String(value);
		});
	}

	/** Get URL param values from this collection as an object */
	private __getUrlParams(): Record<string, unknown> {
		const template = (this.constructor as typeof SyncCollection).url;
		const matches = template.matchAll(/:(\w+)/g);
		const params: Record<string, unknown> = {};
		for (const match of matches) {
			const key = match[1];
			if (key) {
				const value = (this as Record<string, unknown>)[key];
				if (value !== undefined) {
					params[key] = value;
				}
			}
		}
		return params;
	}

	/** Update $meta and emit change */
	private setMeta(updates: Partial<CollectionMeta>): void {
		Object.assign(this.$meta, updates);
		this.__emitChange();
	}

	/** Subscribe to child model changes */
	private __subscribeToChild(item: T): void {
		item.on('change', this.__handleChildChange);
	}

	/** Unsubscribe from child model */
	private __unsubscribeFromChild(item: T): void {
		item.off('change', this.__handleChildChange);
	}

	/** Handle child change - bubble up */
	private __handleChildChange: ChangeCallback = () => {
		this.__emitChange();
	};

	/** Monotonic change counter; changes whenever the collection's contents do. */
	get version(): number {
		return this.__version;
	}

	/** Emit change event */
	private __emitChange(): void {
		this.__version++;
		const listeners = this.__listeners['change'];
		if (listeners) {
			for (const listener of listeners) {
				listener();
			}
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Observable interface
	// ─────────────────────────────────────────────────────────────────────────────

	on(event: 'change', callback: ChangeCallback): void {
		if (!this.__listeners[event]) {
			this.__listeners[event] = [];
		}
		this.__listeners[event].push(callback);
	}

	off(event: 'change', callback: ChangeCallback): void {
		const listeners = this.__listeners[event];
		if (listeners) {
			const index = listeners.indexOf(callback);
			if (index !== -1) {
				listeners.splice(index, 1);
			}
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Read access
	// ─────────────────────────────────────────────────────────────────────────────

	get length(): number {
		return this.__items.length;
	}

	[Symbol.iterator](): Iterator<T> {
		return this.__items[Symbol.iterator]();
	}

	map<U>(fn: (item: T, index: number) => U): U[] {
		return this.__items.map(fn);
	}

	filter(fn: (item: T, index: number) => boolean): T[] {
		return this.__items.filter(fn);
	}

	find(fn: (item: T, index: number) => boolean): T | undefined {
		return this.__items.find(fn);
	}

	findIndex(fn: (item: T, index: number) => boolean): number {
		return this.__items.findIndex(fn);
	}

	some(fn: (item: T, index: number) => boolean): boolean {
		return this.__items.some(fn);
	}

	every(fn: (item: T, index: number) => boolean): boolean {
		return this.__items.every(fn);
	}

	toArray(): T[] {
		return [...this.__items];
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Sync operations
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Fetch all items from the API and reconcile them into the collection in place.
	 *
	 * Existing models are preserved by id and updated only when the server reports a
	 * change (see `changeKey`); missing ones are removed and new ones constructed. This
	 * keeps model identity stable across refetches — an open detail view, expanded rows,
	 * and lazily-loaded children survive a poll — and lets the collection report exactly
	 * which items changed. On any fetch after the first, the changed/added ids are
	 * emitted via `itemsChanged` so callers can flash them.
	 */
	async fetch(): Promise<void> {
		// Coalesce concurrent calls so overlapping refetches can't race to a stale state.
		if (this.__fetchInFlight) return this.__fetchInFlight;
		const run = this.__fetch();
		this.__fetchInFlight = run;
		try {
			await run;
		} finally {
			this.__fetchInFlight = null;
		}
	}

	/** The actual fetch + reconcile; serialized by `fetch()`. */
	private async __fetch(): Promise<void> {
		const isInitial = this.$meta.lastFetched == null;
		this.setMeta({ working: true, error: null });

		try {
			const data = await fetchClient.get<Array<Record<string, unknown>>>(this.getUrl());
			const ModelClass = this.getModelClass();
			const idField = (this.constructor as typeof SyncCollection).Model.idField || 'id';
			const changeKey = (this.constructor as typeof SyncCollection).changeKey;

			// Nested @collection fields (e.g. an item's `children`) are detail loaded
			// separately; a summary list payload sends them empty, so they must not
			// clobber already-loaded children when we re-apply data to an existing model.
			const collectionKeys = (ModelClass as { [Symbol.metadata]?: Record<symbol, unknown> })[
				Symbol.metadata
			]?.[COLLECTIONS] as Map<string, unknown> | undefined;

			// Index the current items by id so we can reuse instances across the refetch.
			const existingById = new Map<unknown, T>();
			for (const item of this.__items) {
				existingById.set((item as unknown as Record<string, unknown>)[idField], item);
			}

			const changedIds: string[] = [];
			const seen = new Set<unknown>();
			// Apply updates to reused instances only after __items is rebuilt, so their
			// change emits never fire against a stale array.
			const pendingUpdates: Array<{ item: T; data: Record<string, unknown> }> = [];

			const nextItems: T[] = [];
			for (const itemData of data) {
				const id = itemData[idField];
				// Skip rows we can't identify, and coalesce duplicate ids in one payload.
				if (id == null || seen.has(id)) continue;
				seen.add(id);

				const mergedData = { ...this.__getUrlParams(), ...itemData };
				const existing = existingById.get(id);

				if (!existing) {
					const item = new ModelClass(mergedData);
					this.__subscribeToChild(item);
					if (!isInitial) changedIds.push(String(id));
					nextItems.push(item);
					continue;
				}

				// Reuse the existing instance. When the model carries a change key, only
				// re-apply (and flag) when it actually moved; otherwise always re-apply.
				// Don't touch a model with a save in flight — that would clobber the edit
				// being saved; the next poll picks up the server's version.
				const prev = (existing as unknown as Record<string, unknown>)[changeKey];
				const next = itemData[changeKey];
				const hasChangeKey = changeKey in itemData;
				const changed = !hasChangeKey || prev !== next;
				if (changed && !existing.$meta.working) {
					// Preserve separately-loaded nested collections (see collectionKeys).
					if (collectionKeys) {
						for (const key of collectionKeys.keys()) delete mergedData[key];
					}
					pendingUpdates.push({ item: existing, data: mergedData });
					// `prev !== undefined` skips the first-ever change-key transition (a
					// locally-added item getting its first server `updatedAt`), which isn't
					// a server-side change worth flashing.
					if (!isInitial && hasChangeKey && prev !== undefined && prev !== next) {
						changedIds.push(String(id));
					}
				}
				nextItems.push(existing);
			}

			// Drop items the server no longer returns.
			for (const [id, item] of existingById) {
				if (!seen.has(id)) {
					this.__unsubscribeFromChild(item);
				}
			}

			this.__items = nextItems;
			for (const { item, data: updateData } of pendingUpdates) {
				item.set(updateData as Partial<ModelData<T>>);
			}

			this.setMeta({ working: false, lastFetched: Date.now() });

			if (changedIds.length > 0) {
				for (const listener of this.__itemsChangedListeners) {
					listener(changedIds);
				}
			}
		} catch (error) {
			this.setMeta({
				working: false,
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}

	/**
	 * Subscribe to the ids changed or added by a reconciling fetch. Fired only for
	 * fetches after the first successful load (the initial load isn't a "change").
	 */
	onItemsChanged(callback: (ids: string[]) => void): void {
		this.__itemsChangedListeners.push(callback);
	}

	offItemsChanged(callback: (ids: string[]) => void): void {
		const index = this.__itemsChangedListeners.indexOf(callback);
		if (index !== -1) {
			this.__itemsChangedListeners.splice(index, 1);
		}
	}

	/**
	 * Add a new item. POSTs to API, adds to collection on success.
	 */
	async add(data: Partial<ModelData<T>>): Promise<T> {
		const ModelClass = this.getModelClass();

		// Merge URL params (e.g., projectId) into data before construction
		const mergedData = { ...this.__getUrlParams(), ...data } as Record<string, unknown>;
		const item = new ModelClass(mergedData);

		// Save to API (will POST since no ID)
		await item.save();

		// A poll that landed during the save may have already inserted an instance for
		// this id; drop it so this saved instance is the single canonical one.
		const idField = (this.constructor as typeof SyncCollection).Model.idField || 'id';
		const id = (item as unknown as Record<string, unknown>)[idField];
		const dupIndex = this.__items.findIndex(
			(existing) => (existing as unknown as Record<string, unknown>)[idField] === id
		);
		if (dupIndex !== -1) {
			this.__unsubscribeFromChild(this.__items[dupIndex]!);
			this.__items.splice(dupIndex, 1);
		}

		// Add to collection
		this.__subscribeToChild(item);
		this.__items.push(item);
		this.__emitChange();

		return item;
	}

	/**
	 * Remove an item. DELETEs from API, removes from collection on success.
	 */
	async remove(item: T): Promise<boolean> {
		if (this.__items.indexOf(item) === -1) {
			return false;
		}

		// Delete from API
		await item.delete();

		// Re-find after the await: a poll may have rebuilt __items in the meantime, so a
		// pre-await index could point at the wrong element.
		const index = this.__items.indexOf(item);
		if (index === -1) {
			return false;
		}

		// Remove from collection
		this.__unsubscribeFromChild(item);
		this.__items.splice(index, 1);
		this.__emitChange();

		return true;
	}
}

/** Add index signature via declaration merging */
// eslint-disable-next-line no-redeclare
export interface SyncCollection<T extends SyncModel> {
	readonly [index: number]: T;
}
