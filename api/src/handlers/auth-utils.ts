/**
 * Shared authentication utilities for handlers
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { getSession, SESSION_COOKIE_NAME } from '@doc-platform/auth';
import { query, type User } from '@doc-platform/db';

/**
 * Get current user from session, including their roles
 * Returns null if user is not found or is inactive
 */
export async function getCurrentUser(context: Context, redis: Redis): Promise<User | null> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) return null;

	const session = await getSession(redis, sessionId);
	if (!session) return null;

	const result = await query<User>(
		'SELECT * FROM users WHERE id = $1',
		[session.userId]
	);

	const user = result.rows[0];

	// Return null if user doesn't exist or is inactive
	// This prevents deactivated users from accessing any user management APIs
	if (!user || !user.is_active) {
		return null;
	}

	return user;
}

/**
 * Check if user has admin role
 */
export function isAdmin(user: User): boolean {
	return user.roles.includes('admin');
}
