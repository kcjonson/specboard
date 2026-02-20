/**
 * @specboard/models - @model decorator
 *
 * Decorator for declaring a property as a nested child model.
 * Handles instantiation and event bubbling.
 *
 * @example
 * ```typescript
 * class Settings extends Model {
 *   @prop accessor theme!: 'light' | 'dark';
 * }
 *
 * class Project extends Model {
 *   @prop accessor id!: string;
 *   @model(Settings) accessor settings!: Settings;
 * }
 * ```
 */

import 'polyfill-symbol-metadata';

import type { Model } from './Model';
import type { ModelConstructor } from './Collection';
import { emitChange, type ChangeCallback, type ModelInternal } from './types';

/** Symbol for storing nested model configs in decorator metadata */
export const NESTED_MODELS = Symbol('nestedModels');

/** Symbol for storing parent callback on child models (for cleanup) */
export const PARENT_CALLBACK = Symbol('parentCallback');

/** Configuration for a nested model property */
export interface NestedModelConfig<T extends Model> {
	ModelClass: ModelConstructor<T>;
}

/**
 * Decorator to mark a class field as a nested child model.
 * Converts the field to a getter/setter that manages a Model instance.
 *
 * @param ModelClass - The Model class to instantiate
 */
export function model<T extends Model>(
	ModelClass: ModelConstructor<T>
): <This, V extends T>(
	_value: ClassAccessorDecoratorTarget<This, V>,
	context: ClassAccessorDecoratorContext<This, V>
) => ClassAccessorDecoratorResult<This, V> {
	return function <This, V extends T>(
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

		// Register nested model config in metadata
		if (!context.metadata[NESTED_MODELS]) {
			context.metadata[NESTED_MODELS] = new Map<string, NestedModelConfig<Model>>();
		}
		(context.metadata[NESTED_MODELS] as Map<string, NestedModelConfig<Model>>).set(name, {
			ModelClass: ModelClass as ModelConstructor<Model>,
		});

		// Return getter/setter that uses __data
		return {
			get(this: This): V {
				const self = this as unknown as ModelInternal;
				return self.__data[name] as V;
			},
			set(this: This, value: V): void {
				const self = this as unknown as ModelInternal;

				// Unsubscribe from old model if exists
				const oldModel = self.__data[name] as (Model & { [PARENT_CALLBACK]?: ChangeCallback }) | undefined;
				if (oldModel && oldModel[PARENT_CALLBACK]) {
					oldModel.off('change', oldModel[PARENT_CALLBACK]);
				}

				// Create new model instance if raw data provided
				let newModel: T & { [PARENT_CALLBACK]?: ChangeCallback };
				if (value instanceof ModelClass) {
					newModel = value as T & { [PARENT_CALLBACK]?: ChangeCallback };
				} else if (value && typeof value === 'object') {
					newModel = new ModelClass(value as Record<string, unknown>) as T & { [PARENT_CALLBACK]?: ChangeCallback };
				} else {
					// Can't create model from null/undefined
					self.__data[name] = undefined;
					emitChange(self);
					return;
				}

				// Create callback that references self for later cleanup
				const parentCallback: ChangeCallback = () => emitChange(self);
				newModel[PARENT_CALLBACK] = parentCallback;

				// Subscribe to child changes
				newModel.on('change', parentCallback);
				self.__data[name] = newModel;

				// Emit change event
				emitChange(self);
			},
		};
	};
}
