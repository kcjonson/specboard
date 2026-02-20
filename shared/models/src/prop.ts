/**
 * @specboard/models - @prop decorator
 *
 * Native ES decorator for registering Model properties.
 * Uses decorator metadata to store property names at class definition time.
 */

import 'polyfill-symbol-metadata';

/** Symbol for storing property names in decorator metadata */
export const PROPERTIES = Symbol('properties');

/**
 * Decorator to mark a class field as a Model property.
 * Converts the field to a getter/setter that stores data in __data.
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
export function prop<T, V>(
	_value: ClassAccessorDecoratorTarget<T, V>,
	context: ClassAccessorDecoratorContext<T, V>
): ClassAccessorDecoratorResult<T, V> {
	const name = context.name as string;

	// Prevent reserved property names
	if (name.startsWith('__') || name.startsWith('$')) {
		throw new Error(
			`Property "${name}" uses a reserved prefix. Property names cannot start with "__" or "$".`
		);
	}

	// Register property in metadata
	if (!context.metadata[PROPERTIES]) {
		context.metadata[PROPERTIES] = new Set<string>();
	}
	(context.metadata[PROPERTIES] as Set<string>).add(name);

	// Return getter/setter that uses __data
	return {
		get(this: T): V {
			const self = this as unknown as { __data: Record<string, unknown> };
			return self.__data[name] as V;
		},
		set(this: T, value: V): void {
			const self = this as unknown as {
				__data: Record<string, unknown>;
				__listeners: Record<string, Array<() => void>>;
			};
			self.__data[name] = value;
			// Emit change event
			const listeners = self.__listeners['change'];
			if (listeners) {
				for (const listener of listeners) {
					listener();
				}
			}
		},
	};
}
