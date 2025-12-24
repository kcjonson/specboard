/**
 * @doc-platform/models - Model base class
 *
 * Observable state container with change subscriptions.
 * Use the @prop decorator on accessor fields to define properties.
 * Use the @collection decorator for child model collections.
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

import { type ChangeCallback, type ModelData, type Observable } from './types';
import { PROPERTIES } from './prop';
import { COLLECTIONS, type CollectionConfig } from './collection-decorator';
import { NESTED_MODELS, type NestedModelConfig } from './model-decorator';
import { Collection, type ModelConstructor } from './Collection';

/**
 * Gets the properties Set from decorator metadata.
 */
function getProperties(model: Model): Set<string> | undefined {
	const ctor = model.constructor as { [Symbol.metadata]?: Record<symbol, unknown> };
	const metadata = ctor[Symbol.metadata];
	return metadata?.[PROPERTIES] as Set<string> | undefined;
}

/**
 * Gets the collections Map from decorator metadata.
 */
function getCollections(model: Model): Map<string, CollectionConfig<Model>> | undefined {
	const ctor = model.constructor as { [Symbol.metadata]?: Record<symbol, unknown> };
	const metadata = ctor[Symbol.metadata];
	return metadata?.[COLLECTIONS] as Map<string, CollectionConfig<Model>> | undefined;
}

/**
 * Gets the nested models Map from decorator metadata.
 */
function getNestedModels(model: Model): Map<string, NestedModelConfig<Model>> | undefined {
	const ctor = model.constructor as { [Symbol.metadata]?: Record<symbol, unknown> };
	const metadata = ctor[Symbol.metadata];
	return metadata?.[NESTED_MODELS] as Map<string, NestedModelConfig<Model>> | undefined;
}

export class Model implements Observable {
	/** Internal data storage */
	protected __data: Record<string, unknown> = {};

	/** Event listeners */
	protected __listeners: Record<string, ChangeCallback[]> = {};

	/** Metadata */
	readonly $meta: Record<string, unknown> = {};

	constructor(initialData?: Record<string, unknown>) {
		// Get metadata
		const properties = getProperties(this);
		const collections = getCollections(this);
		const nestedModels = getNestedModels(this);

		// Verify at least one property, collection, or nested model is registered
		const propCount = properties?.size ?? 0;
		const collCount = collections?.size ?? 0;
		const nestedCount = nestedModels?.size ?? 0;

		if (propCount === 0 && collCount === 0 && nestedCount === 0) {
			throw new Error(
				`Model "${this.constructor.name}" has no properties. Use @prop, @collection, or @model decorators on accessor fields.`
			);
		}

		// Helper to create parent change callback
		const createParentCallback = (): ChangeCallback => {
			return () => {
				const listeners = this.__listeners['change'];
				if (listeners) {
					for (const listener of listeners) {
						listener();
					}
				}
			};
		};

		// Set initial data directly to __data (bypassing setters to avoid change events)
		if (initialData) {
			for (const [key, value] of Object.entries(initialData)) {
				// Handle @prop properties
				if (properties?.has(key)) {
					this.__data[key] = value;
				}
				// Handle @collection properties
				else if (collections?.has(key)) {
					const config = collections.get(key)!;
					const col = new Collection(
						config.ModelClass as ModelConstructor<Model>,
						Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
					);
					col.__setParentCallback(createParentCallback());
					this.__data[key] = col;
				}
				// Handle @model (nested model) properties
				else if (nestedModels?.has(key)) {
					const config = nestedModels.get(key)!;
					if (value && typeof value === 'object') {
						const nested = new config.ModelClass(value as Record<string, unknown>);
						nested.on('change', createParentCallback());
						this.__data[key] = nested;
					}
				}
			}
		}

		// Initialize any collections not provided in initial data
		if (collections) {
			for (const [key, config] of collections) {
				if (!(key in this.__data)) {
					const col = new Collection(config.ModelClass as ModelConstructor<Model>);
					col.__setParentCallback(createParentCallback());
					this.__data[key] = col;
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
		const collections = getCollections(this);
		const nestedModels = getNestedModels(this);

		if (typeof dataOrProperty === 'object' && dataOrProperty !== null) {
			// Batch update - set all properties, emit once
			for (const [property, propValue] of Object.entries(dataOrProperty)) {
				if (properties?.has(property)) {
					this.__data[property] = propValue;
				} else if (collections?.has(property)) {
					// For collections, reset the existing collection (don't replace it)
					const col = this.__data[property] as Collection<Model>;
					col.reset(
						Array.isArray(propValue)
							? (propValue as Array<Record<string, unknown>>)
							: []
					);
				} else if (nestedModels?.has(property)) {
					// For nested models, use the setter to handle subscription management
					(this as Record<string, unknown>)[property] = propValue;
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
			if (
				properties?.has(dataOrProperty) ||
				collections?.has(dataOrProperty) ||
				nestedModels?.has(dataOrProperty)
			) {
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
