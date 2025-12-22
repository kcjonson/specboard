/**
 * @doc-platform/models - Model base class
 *
 * Observable state container with change subscriptions.
 */

import { type ChangeCallback } from './types';

/**
 * Emits a change event to all listeners.
 */
function emit(this: Model): void {
	const listeners = this.__listeners['change'];
	if (listeners) {
		for (const listener of listeners) {
			listener();
		}
	}
}

/**
 * Gets the static properties Set from a Model class.
 */
function getProperties(model: Model): Set<string> | undefined {
	const ctor = model.constructor as typeof Model;
	return ctor.properties as Set<string> | undefined;
}

/**
 * Gets a property value from internal data.
 */
function get(this: Model, property: string): unknown {
	const properties = getProperties(this);

	if (properties?.has(property)) {
		return this.__data[property];
	} else {
		console.warn(`Skipping get: property "${property}" is invalid on "${this.constructor.name}" model`);
		return undefined;
	}
}

/**
 * Sets a property value on internal data.
 */
function setProp(this: Model, property: string, value: unknown, doEmit = true): void {
	const properties = getProperties(this);

	if (properties?.has(property)) {
		this.__data[property] = value;
		if (doEmit) {
			emit.call(this);
		}
	} else {
		console.warn(`Skipping set: property "${property}" is invalid on "${this.constructor.name}" model`);
	}
}

export class Model<T extends Record<string, unknown> = Record<string, unknown>> {
	/** Static properties Set - subclasses must override this */
	static properties: Set<string> = new Set();

	/** Internal data storage (non-enumerable) */
	protected declare readonly __data: Record<string, unknown>;

	/** Event listeners (non-enumerable) */
	protected declare readonly __listeners: Record<string, ChangeCallback[]>;

	/** Metadata (non-enumerable) */
	declare readonly $meta: Record<string, unknown>;

	constructor(initialData?: Partial<T>) {
		Object.defineProperty(this, '__data', {
			value: {},
			enumerable: false,
			writable: false,
		});

		Object.defineProperty(this, '__listeners', {
			value: {},
			enumerable: false,
			writable: false,
		});

		Object.defineProperty(this, '$meta', {
			value: {},
			enumerable: false,
			writable: false,
		});

		// Create getters/setters for each registered property
		const properties = getProperties(this);

		if (!properties || properties.size === 0) {
			throw new Error(`Model "${this.constructor.name}" has no properties. Define static properties on the class.`);
		}

		for (const property of properties) {
			Object.defineProperty(this, property, {
				enumerable: true,
				get: get.bind(this, property),
				set: setProp.bind(this, property),
			});
		}

		// Set initial data
		if (initialData) {
			this.set(initialData);
		}

		// Freeze the instance to prevent adding new properties
		Object.freeze(this);
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
		if (typeof dataOrProperty === 'object' && dataOrProperty !== null) {
			// Batch update - set all properties, emit once
			for (const [property, propValue] of Object.entries(dataOrProperty)) {
				setProp.call(this, property, propValue, false);
			}
			emit.call(this);
		} else if (typeof dataOrProperty === 'string') {
			// Single property update
			setProp.call(this, dataOrProperty, value);
		} else {
			console.warn(`Unable to set properties of type: ${typeof dataOrProperty} on Model`);
		}
	}
}
