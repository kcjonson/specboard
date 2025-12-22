/**
 * @doc-platform/models - Model base class
 *
 * Observable state container with change subscriptions.
 * Use the @prop decorator on accessor fields to define properties.
 */

import { type ChangeCallback } from './types';
import { PROPERTIES } from './prop';

/**
 * Gets the properties Set from decorator metadata.
 */
function getProperties(model: Model): Set<string> | undefined {
	const ctor = model.constructor as { [Symbol.metadata]?: Record<symbol, unknown> };
	const metadata = ctor[Symbol.metadata];
	return metadata?.[PROPERTIES] as Set<string> | undefined;
}

export class Model<T extends Record<string, unknown> = Record<string, unknown>> {
	/** Internal data storage */
	protected __data: Record<string, unknown> = {};

	/** Event listeners */
	protected __listeners: Record<string, ChangeCallback[]> = {};

	/** Metadata */
	readonly $meta: Record<string, unknown> = {};

	constructor(initialData?: Partial<T>) {
		// Verify properties are registered via @prop decorator
		const properties = getProperties(this);

		if (!properties || properties.size === 0) {
			throw new Error(`Model "${this.constructor.name}" has no properties. Use @prop decorator on accessor fields.`);
		}

		// Set initial data using the setters (which are defined by @prop decorator)
		if (initialData) {
			for (const [key, value] of Object.entries(initialData)) {
				if (properties.has(key)) {
					// Use the setter, but don't emit changes during initialization
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
	 * Set one or more properties.
	 *
	 * @example
	 * // Set multiple properties (single change event)
	 * user.set({ name: 'John', email: 'john@example.com' });
	 *
	 * // Set single property
	 * user.set('name', 'John');
	 */
	set(data: Partial<T>): void;
	set(property: keyof T, value: T[keyof T]): void;
	set(dataOrProperty: Partial<T> | keyof T, value?: T[keyof T]): void {
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
