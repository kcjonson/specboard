import type { Context, MiddlewareHandler } from 'hono';
import { query, type User, type UserRole } from '@specboard/db';
import type { AuthVariables } from './middleware.ts';

/**
 * Extended auth variables that include full user data
 */
export interface AdminAuthVariables extends AuthVariables {
	fullUser: User;
}

/**
 * Middleware that requires admin role
 * Must be used after authMiddleware (requires user.id in context)
 *
 * This middleware:
 * 1. Fetches the full user record from the database
 * 2. Verifies the user is active
 * 3. Verifies the user has admin role
 * 4. Attaches full user data to context
 *
 * @example
 * ```typescript
 * app.use('/api/admin/*', requireAdmin());
 *
 * app.get('/api/admin/users', (c) => {
 *   const user = c.get('fullUser'); // Full User object
 *   // ...
 * });
 * ```
 */
export function requireAdmin(): MiddlewareHandler<{ Variables: AdminAuthVariables }> {
	return async (c: Context<{ Variables: AdminAuthVariables }>, next) => {
		const userId = c.get('user')?.id;

		if (!userId) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

		// Fetch full user from database
		const result = await query<User>(
			'SELECT * FROM users WHERE id = $1',
			[userId]
		);

		const user = result.rows[0];

		if (!user) {
			return c.json({ error: 'User not found' }, 401);
		}

		// Check if user is active
		if (!user.is_active) {
			return c.json({ error: 'Account is deactivated' }, 403);
		}

		// Check if user has admin role
		if (!user.roles.includes('admin')) {
			return c.json({ error: 'Admin access required' }, 403);
		}

		// Attach full user to context
		c.set('fullUser', user);

		return next();
	};
}

/**
 * Get the full user from admin context
 * Throws if not available (use after requireAdmin middleware)
 */
export function getAdminUser(c: Context<{ Variables: AdminAuthVariables }>): User {
	const user = c.get('fullUser');
	if (!user) {
		throw new Error('Admin user not in context');
	}
	return user;
}

/**
 * Known valid roles
 */
const VALID_ROLES = new Set<string>(['admin']);

/**
 * Check if a role string is valid
 */
export function isValidRole(role: string): role is UserRole {
	return VALID_ROLES.has(role);
}

/**
 * Check if a user has a specific role
 */
export function hasRole(user: User, role: string): boolean {
	return user.roles.includes(role);
}

/**
 * Check if a user has any of the specified roles
 */
export function hasAnyRole(user: User, roles: string[]): boolean {
	return roles.some(role => user.roles.includes(role));
}
