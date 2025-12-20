/**
 * @doc-platform/models - Property utilities
 *
 * Helper for defining Model properties with TypeScript type inference.
 */

/**
 * Define properties for a Model class.
 * Returns a Set of property names for use as static properties.
 *
 * @example
 * ```typescript
 * class User extends Model<UserData> {
 *   static properties = defineProperties<UserData>();
 * }
 *
 * interface UserData {
 *   id: number;
 *   name: string;
 *   email: string | null;
 * }
 * ```
 */
export function defineProperties<T>(...keys: (keyof T)[]): Set<keyof T> {
	return new Set(keys);
}
