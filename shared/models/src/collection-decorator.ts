/**
 * @specboard/models - @collection decorator
 *
 * Decorator for declaring a property as a collection of child models.
 * Handles instantiation, event bubbling, and subscription management.
 *
 * @example
 * ```typescript
 * class Epic extends Model {
 *   @prop accessor id!: string;
 *   @collection(Task) accessor tasks!: Collection<Task>;
 * }
 * ```
 */

import 'polyfill-symbol-metadata';

import type { Model } from './Model';
import { createCollection, type Collection, type ModelConstructor } from './Collection';
import { emitChange, type ModelInternal } from './types';

/** Symbol for storing collection configs in decorator metadata */
export const COLLECTIONS = Symbol('collections');

/** Configuration for a collection property */
export interface CollectionConfig<T extends Model> {
	ModelClass: ModelConstructor<T>;
}

/**
 * Decorator to mark a class field as a collection of child models.
 * Converts the field to a getter/setter that manages a Collection instance.
 *
 * @param ModelClass - The Model class to instantiate for each item
 */
export function collection<T extends Model>(
	ModelClass: ModelConstructor<T>
): <This, V extends Collection<T>>(
	_value: ClassAccessorDecoratorTarget<This, V>,
	context: ClassAccessorDecoratorContext<This, V>
) => ClassAccessorDecoratorResult<This, V> {
	return function <This, V extends Collection<T>>(
		_value: ClassAccessorDecoratorTarget<This, V>,
		context: ClassAccessorDecoratorContext<This, V>
	): ClassAccessorDecoratorResult<This, V> {
		const name = context.name as string;

		// Prevent reserved property names
		if (name.startsWith('__') || name.startsWith('$')) {
			throw new Error(
				`Property "${name}" uses a reserved prefix. Property names cannot start with "__" or "$".`
			);
		}

		// Register collection config in metadata
		if (!context.metadata[COLLECTIONS]) {
			context.metadata[COLLECTIONS] = new Map<string, CollectionConfig<Model>>();
		}
		(context.metadata[COLLECTIONS] as Map<string, CollectionConfig<Model>>).set(name, {
			ModelClass: ModelClass as ModelConstructor<Model>,
		});

		// Return getter/setter that uses __data
		return {
			get(this: This): V {
				const self = this as unknown as ModelInternal;
				let col = self.__data[name] as V | undefined;

				// Lazily create empty collection if not set
				if (!col) {
					col = createCollection(ModelClass) as V;
					self.__data[name] = col;
					// Wire up parent callback
					(col as Collection<T>).__setParentCallback(() => emitChange(self));
				}

				return col;
			},
			set(this: This, value: V): void {
				const self = this as unknown as ModelInternal;

				// If setting raw array data, convert to Collection
				let col: Collection<T>;
				if (Array.isArray(value)) {
					col = createCollection(ModelClass, value as Array<Record<string, unknown>>);
				} else if (value && typeof value === 'object' && '__setParentCallback' in value) {
					// Already a Collection
					col = value as Collection<T>;
				} else {
					// Create empty collection for null/undefined
					col = createCollection(ModelClass);
				}

				// Wire up parent callback for event bubbling
				col.__setParentCallback(() => emitChange(self));

				self.__data[name] = col;

				// Emit change event
				emitChange(self);
			},
		};
	};
}
