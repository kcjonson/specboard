/**
 * @specboard/models - Collection type
 *
 * A typed collection of child models with event bubbling.
 * Implements Observable for use with useModel hook.
 * Supports array index access: collection[0], collection[1], etc.
 *
 * @example
 * ```typescript
 * class Epic extends Model {
 *   @prop accessor id!: string;
 *   @collection(Task) accessor tasks!: Collection<Task>;
 * }
 *
 * const epic = new Epic({ id: '1', tasks: [{ id: 't1', title: 'Task 1' }] });
 * epic.tasks[0].title = 'Updated'; // Bubbles change to epic
 * ```
 */

import type { Model } from './Model';
import type { ChangeCallback, Observable, ModelData } from './types';

/** Constructor type for Model subclasses */
export interface ModelConstructor<T extends Model> {
	new (initialData?: Record<string, unknown>): T;
}

/** Collection type with array index access */
export type Collection<T extends Model> = CollectionImpl<T> & {
	readonly [index: number]: T;
};

/**
 * Creates a proxied Collection with array index access.
 */
export function createCollection<T extends Model>(
	ModelClass: ModelConstructor<T>,
	initialData?: Array<Record<string, unknown>>
): Collection<T> {
	const collection = new CollectionImpl<T>(ModelClass, initialData);
	return createProxy(collection);
}

/**
 * Creates a Proxy that enables array index access on Collection.
 */
function createProxy<T extends Model>(collection: CollectionImpl<T>): Collection<T> {
	return new Proxy(collection, {
		get(target, prop, receiver) {
			// Handle numeric index access
			if (typeof prop === 'string' && /^\d+$/.test(prop)) {
				return target.__getItem(parseInt(prop, 10));
			}
			return Reflect.get(target, prop, receiver);
		},
		set(target, prop, value, receiver) {
			// Prevent direct index assignment (use add/insert instead)
			if (typeof prop === 'string' && /^\d+$/.test(prop)) {
				throw new Error(
					"Cannot replace collection items by index. Use add() or insert() to add items, or modify the item's properties directly."
				);
			}
			return Reflect.set(target, prop, value, receiver);
		},
	}) as Collection<T>;
}

class CollectionImpl<T extends Model> implements Observable {
	/** The Model class used to instantiate items */
	private readonly __ModelClass: ModelConstructor<T>;

	/** Internal storage of model instances */
	private __items: T[] = [];

	/** Event listeners */
	private __listeners: Record<string, ChangeCallback[]> = {};

	/** Callback to notify parent of changes */
	private __onChildChange: ChangeCallback | null = null;

	constructor(ModelClass: ModelConstructor<T>, initialData?: Array<Record<string, unknown>>) {
		this.__ModelClass = ModelClass;

		if (initialData) {
			for (const data of initialData) {
				const item = new ModelClass(data);
				this.__subscribeToChild(item);
				this.__items.push(item);
			}
		}
	}

	/**
	 * Get item at index (used by Proxy for index access).
	 */
	__getItem(index: number): T | undefined {
		return this.__items[index];
	}

	/**
	 * Set the callback for notifying parent model of changes.
	 * Called by the @collection decorator.
	 */
	__setParentCallback(callback: ChangeCallback): void {
		this.__onChildChange = callback;
	}

	/**
	 * Subscribe to a child model's changes.
	 */
	private __subscribeToChild(item: T): void {
		item.on('change', this.__handleChildChange);
	}

	/**
	 * Unsubscribe from a child model's changes.
	 */
	private __unsubscribeFromChild(item: T): void {
		item.off('change', this.__handleChildChange);
	}

	/**
	 * Handle change events from child models.
	 * Bubbles the change to collection listeners and parent.
	 */
	private __handleChildChange: ChangeCallback = () => {
		this.__emitChange();
	};

	/**
	 * Emit change event to all listeners and parent.
	 */
	private __emitChange(): void {
		// Notify collection listeners
		const listeners = this.__listeners['change'];
		if (listeners) {
			for (const listener of listeners) {
				listener();
			}
		}

		// Notify parent model
		if (this.__onChildChange) {
			this.__onChildChange();
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

	/**
	 * Number of items in the collection.
	 */
	get length(): number {
		return this.__items.length;
	}

	/**
	 * Iterate over items.
	 */
	[Symbol.iterator](): Iterator<T> {
		return this.__items[Symbol.iterator]();
	}

	/**
	 * Map over items.
	 */
	map<U>(fn: (item: T, index: number) => U): U[] {
		return this.__items.map(fn);
	}

	/**
	 * Filter items.
	 */
	filter(fn: (item: T, index: number) => boolean): T[] {
		return this.__items.filter(fn);
	}

	/**
	 * Find an item.
	 */
	find(fn: (item: T, index: number) => boolean): T | undefined {
		return this.__items.find(fn);
	}

	/**
	 * Find index of an item.
	 */
	findIndex(fn: (item: T, index: number) => boolean): number {
		return this.__items.findIndex(fn);
	}

	/**
	 * Check if any item matches.
	 */
	some(fn: (item: T, index: number) => boolean): boolean {
		return this.__items.some(fn);
	}

	/**
	 * Check if all items match.
	 */
	every(fn: (item: T, index: number) => boolean): boolean {
		return this.__items.every(fn);
	}

	/**
	 * Get all items as an array (shallow copy).
	 */
	toArray(): T[] {
		return [...this.__items];
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Mutations (trigger change events)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Add a new item to the end of the collection.
	 * @returns The newly created model instance.
	 */
	add(data: Partial<ModelData<T>>): T {
		const item = new this.__ModelClass(data as Record<string, unknown>);
		this.__subscribeToChild(item);
		this.__items.push(item);
		this.__emitChange();
		return item;
	}

	/**
	 * Insert a new item at a specific index.
	 * Index is clamped to valid bounds (0 to length).
	 * @returns The newly created model instance.
	 */
	insert(index: number, data: Partial<ModelData<T>>): T {
		// Clamp index to valid bounds
		const clampedIndex = Math.max(0, Math.min(index, this.__items.length));
		const item = new this.__ModelClass(data as Record<string, unknown>);
		this.__subscribeToChild(item);
		this.__items.splice(clampedIndex, 0, item);
		this.__emitChange();
		return item;
	}

	/**
	 * Remove an item from the collection.
	 * @returns true if item was found and removed.
	 */
	remove(item: T): boolean {
		const index = this.__items.indexOf(item);
		if (index === -1) {
			return false;
		}
		this.__unsubscribeFromChild(item);
		this.__items.splice(index, 1);
		this.__emitChange();
		return true;
	}

	/**
	 * Remove item at a specific index.
	 * @returns The removed item, or undefined if index is out of bounds.
	 */
	removeAt(index: number): T | undefined {
		if (index < 0 || index >= this.__items.length) {
			return undefined;
		}
		const item = this.__items[index] as T;
		this.__unsubscribeFromChild(item);
		this.__items.splice(index, 1);
		this.__emitChange();
		return item;
	}

	/**
	 * Move an item from one index to another.
	 * No-op if either index is out of bounds or indices are equal.
	 * Does not emit change event for no-op cases.
	 */
	move(fromIndex: number, toIndex: number): void {
		if (fromIndex < 0 || fromIndex >= this.__items.length) {
			return;
		}
		if (toIndex < 0 || toIndex >= this.__items.length) {
			return;
		}
		if (fromIndex === toIndex) {
			return;
		}

		const removed = this.__items.splice(fromIndex, 1);
		const item = removed[0];
		if (!item) {
			return;
		}
		this.__items.splice(toIndex, 0, item);
		this.__emitChange();
	}

	/**
	 * Clear all items, optionally replacing with new data.
	 */
	clear(dataArray?: Array<Partial<ModelData<T>>>): void {
		// Unsubscribe from all current items
		for (const item of this.__items) {
			this.__unsubscribeFromChild(item);
		}

		// Create new items if provided
		if (dataArray && dataArray.length > 0) {
			this.__items = dataArray.map((data) => {
				const item = new this.__ModelClass(data as Record<string, unknown>);
				this.__subscribeToChild(item);
				return item;
			});
		} else {
			this.__items = [];
		}

		this.__emitChange();
	}
}
