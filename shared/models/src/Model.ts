/**
 * @doc-platform/models - Model base class
 *
 * Observable state container with change subscriptions.
 * Use the @prop decorator on accessor fields to define properties.
 *
 * @example
 * ```typescript
 * class User extends Model {
 *   @prop accessor id!: number;
 *   @prop accessor name!: string;
 *   @prop accessor email!: string | null;
 * }
 *
 * const user = new User({ id: 1, name: 'John', email: null });
 * ```
 */

import { type ChangeCallback, type ModelData } from './types';
import { PROPERTIES } from './prop';

/**
 * Gets the properties Set from decorator metadata.
 */
function getProperties(model: Model): Set<string> | undefined {
	const ctor = model.constructor as { [Symbol.metadata]?: Record<symbol, unknown> };
	const metadata = ctor[Symbol.metadata];
	return metadata?.[PROPERTIES] as Set<string> | undefined;
}

export class Model {
	/** Internal data storage */
	protected __data: Record<string, unknown> = {};

	/** Event listeners */
	protected __listeners: Record<string, ChangeCallback[]> = {};

	/** Metadata */
	readonly $meta: Record<string, unknown> = {};

	constructor(initialData?: Record<string, unknown>) {
		// Verify properties are registered via @prop decorator
		const properties = getProperties(this);

		if (!properties || properties.size === 0) {
			throw new Error(`Model "${this.constructor.name}" has no properties. Use @prop decorator on accessor fields.`);
		}

		// Set initial data directly to __data (bypassing setters to avoid change events)
		if (initialData) {
			for (const [key, value] of Object.entries(initialData)) {
				if (properties.has(key)) {
					this.__data[key] = value;
				}
			}
		}
	}

	/**
	 * Subscribe to change events.
	 */
	on(event: 'change', callback: ChangeCallback): void {
		if (!this.__listeners[event]) {
			this.__listeners[event] = [];
		}
		this.__listeners[event].push(callback);
	}

	/**
	 * Unsubscribe from change events.
	 */
	off(event: 'change', callback: ChangeCallback): void {
		const listeners = this.__listeners[event];
		if (listeners) {
			const index = listeners.indexOf(callback);
			if (index !== -1) {
				listeners.splice(index, 1);
			}
		}
	}

	/**
	 * Set one or more properties.
	 *
	 * @example
	 * // Set multiple properties (single change event)
	 * user.set({ name: 'John', email: 'john@example.com' });
	 *
	 * // Set single property
	 * user.set('name', 'John');
	 */
	set<K extends keyof ModelData<this>>(data: Partial<ModelData<this>>): void;
	set<K extends keyof ModelData<this>>(property: K, value: ModelData<this>[K]): void;
	set<K extends keyof ModelData<this>>(
		dataOrProperty: Partial<ModelData<this>> | K,
		value?: ModelData<this>[K]
	): void {
		const properties = getProperties(this);

		if (typeof dataOrProperty === 'object' && dataOrProperty !== null) {
			// Batch update - set all properties, emit once
			for (const [property, propValue] of Object.entries(dataOrProperty)) {
				if (properties?.has(property)) {
					this.__data[property] = propValue;
				} else {
					console.warn(`Skipping set: property "${property}" is invalid on "${this.constructor.name}" model`);
				}
			}
			// Emit single change event
			const listeners = this.__listeners['change'];
			if (listeners) {
				for (const listener of listeners) {
					listener();
				}
			}
		} else if (typeof dataOrProperty === 'string') {
			// Single property update - use the setter which emits
			if (properties?.has(dataOrProperty)) {
				// Access via this[property] to use the accessor's setter
				(this as Record<string, unknown>)[dataOrProperty] = value;
			} else {
				console.warn(`Skipping set: property "${dataOrProperty}" is invalid on "${this.constructor.name}" model`);
			}
		} else {
			console.warn(`Unable to set properties of type: ${typeof dataOrProperty} on Model`);
		}
	}
}
