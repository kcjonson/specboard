/**
 * @specboard/models - SyncCollection
 *
 * A collection that syncs with a REST API.
 * Auto-fetches on construction, items are SyncModels.
 *
 * @example
 * ```typescript
 * class EpicsCollection extends SyncCollection<EpicModel> {
 *   static url = '/api/epics';
 *   static Model = EpicModel;
 *
 *   byStatus(status: Status): EpicModel[] {
 *     return this.filter((e) => e.status === status);
 *   }
 * }
 *
 * const epics = new EpicsCollection(); // Auto-fetches
 * epics.$meta.working // true while loading
 * epics[0] // index access works
 * epics.byStatus('ready') // custom methods work
 * ```
 */

import { fetchClient } from '@specboard/fetch';
import type { SyncModel } from './SyncModel';
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

	/** Internal storage */
	private __items: T[] = [];

	/** Event listeners */
	private __listeners: Record<string, ChangeCallback[]> = {};

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

	/** Emit change event */
	private __emitChange(): void {
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
	 * Fetch all items from the API.
	 */
	async fetch(): Promise<void> {
		this.setMeta({ working: true, error: null });

		try {
			const data = await fetchClient.get<Array<Record<string, unknown>>>(this.getUrl());
			const ModelClass = this.getModelClass();

			// Clear existing items
			for (const item of this.__items) {
				this.__unsubscribeFromChild(item);
			}

			// Create new model instances from data, merging collection's URL params
			this.__items = data.map((itemData) => {
				// Merge URL params (e.g., projectId) into item data before construction
				const mergedData = { ...this.__getUrlParams(), ...itemData };
				const item = new ModelClass(mergedData);
				this.__subscribeToChild(item);
				return item;
			});

			this.setMeta({ working: false, lastFetched: Date.now() });
		} catch (error) {
			this.setMeta({
				working: false,
				error: error instanceof Error ? error : new Error(String(error)),
			});
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
		const index = this.__items.indexOf(item);
		if (index === -1) {
			return false;
		}

		// Delete from API
		await item.delete();

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
