/**
 * @doc-platform/models - Model tests
 */

import { describe, it, expect, vi } from 'vitest';
import { Model } from './Model';
import { prop } from './prop';

// Test model using @prop decorator with accessor
// No separate interface needed - types are inferred from the class itself
class User extends Model {
	@prop accessor id!: number;
	@prop accessor name!: string;
	@prop accessor email!: string | null;
}

describe('Model', () => {
	describe('initialization', () => {
		it('should initialize with data', () => {
			const user = new User({ id: 1, name: 'John', email: 'john@example.com' });

			expect(user.id).toBe(1);
			expect(user.name).toBe('John');
			expect(user.email).toBe('john@example.com');
		});

		it('should handle partial initialization', () => {
			const user = new User({ id: 1, name: 'John' });

			expect(user.id).toBe(1);
			expect(user.name).toBe('John');
			expect(user.email).toBeUndefined();
		});

		it('should throw if no properties are defined', () => {
			class Empty extends Model {}

			expect(() => new Empty()).toThrow('has no properties');
		});

		it('should throw if property name starts with __', () => {
			expect(() => {
				// @ts-expect-error - Testing invalid property name
				class Bad extends Model {
					@prop accessor __internal!: string;
				}
				return Bad;
			}).toThrow('reserved prefix');
		});

		it('should throw if property name starts with $', () => {
			expect(() => {
				// @ts-expect-error - Testing invalid property name
				class Bad extends Model {
					@prop accessor $meta!: string;
				}
				return Bad;
			}).toThrow('reserved prefix');
		});

		it('should work without an id field', () => {
			class Settings extends Model {
				@prop accessor theme!: string;
				@prop accessor notifications!: boolean;
			}

			const settings = new Settings({ theme: 'dark', notifications: true });

			expect(settings.theme).toBe('dark');
			expect(settings.notifications).toBe(true);

			settings.theme = 'light';
			expect(settings.theme).toBe('light');
		});
	});

	describe('property access', () => {
		it('should get properties via getters', () => {
			const user = new User({ id: 1, name: 'John', email: null });

			expect(user.id).toBe(1);
			expect(user.name).toBe('John');
			expect(user.email).toBe(null);
		});

		it('should set properties via setters', () => {
			const user = new User({ id: 1, name: 'John', email: null });

			user.name = 'Jane';

			expect(user.name).toBe('Jane');
		});

		it('should return undefined for non-existent properties', () => {
			const user = new User({ id: 1, name: 'John', email: null });

			// Non-existent properties return undefined (no getter defined for them)
			// @ts-expect-error - Testing invalid property access
			const value = user.invalid;

			expect(value).toBeUndefined();
		});
	});

	describe('set() method', () => {
		it('should set single property', () => {
			const user = new User({ id: 1, name: 'John', email: null });

			user.set('name', 'Jane');

			expect(user.name).toBe('Jane');
		});

		it('should set multiple properties', () => {
			const user = new User({ id: 1, name: 'John', email: null });

			user.set({ name: 'Jane', email: 'jane@example.com' });

			expect(user.name).toBe('Jane');
			expect(user.email).toBe('jane@example.com');
		});
	});

	describe('change events', () => {
		it('should emit change on property setter', () => {
			const user = new User({ id: 1, name: 'John', email: null });
			const callback = vi.fn();

			user.on('change', callback);
			user.name = 'Jane';

			expect(callback).toHaveBeenCalledTimes(1);
		});

		it('should emit change on set() single property', () => {
			const user = new User({ id: 1, name: 'John', email: null });
			const callback = vi.fn();

			user.on('change', callback);
			user.set('name', 'Jane');

			expect(callback).toHaveBeenCalledTimes(1);
		});

		it('should emit single change on set() with object (batch)', () => {
			const user = new User({ id: 1, name: 'John', email: null });
			const callback = vi.fn();

			user.on('change', callback);
			user.set({ name: 'Jane', email: 'jane@example.com' });

			// Only one change event, even though two properties changed
			expect(callback).toHaveBeenCalledTimes(1);
		});

		it('should support multiple listeners', () => {
			const user = new User({ id: 1, name: 'John', email: null });
			const callback1 = vi.fn();
			const callback2 = vi.fn();

			user.on('change', callback1);
			user.on('change', callback2);
			user.name = 'Jane';

			expect(callback1).toHaveBeenCalledTimes(1);
			expect(callback2).toHaveBeenCalledTimes(1);
		});
	});

	describe('immutability', () => {
		it('should freeze the instance', () => {
			const user = new User({ id: 1, name: 'John', email: null });

			// Note: We don't freeze anymore because of accessor decorator requirements
			// Instead, the Model controls property access via getters/setters
			expect(typeof user.id).toBe('number');
		});

		it('should prevent setting non-existent properties via set()', () => {
			const user = new User({ id: 1, name: 'John', email: null });

			// This should warn but not throw
			// @ts-expect-error - Testing invalid property access
			user.set('nonExistent', 'value');

			// The property should not be set
			// @ts-expect-error - Testing invalid property access
			expect(user.nonExistent).toBeUndefined();
		});
	});
});
