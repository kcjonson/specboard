/**
 * Shared authentication utilities for handlers
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { getSession, SESSION_COOKIE_NAME } from '@specboard/auth';
import { query, type User } from '@specboard/db';

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
export function isAdmin(user: Pick<User, 'roles'>): boolean {
	return user.roles.includes('admin');
}

/**
 * Finish a write of session isAdmin flags (`written`, via `write`) by
 * re-reading the user's roles and rewriting until a read matches the last
 * write. Every writer of the flag ends this way and a role change commits
 * before it scans sessions, so the last write to any session comes from a
 * read no older than the last role commit: a read that missed that commit
 * preceded it, so that commit's own scan wrote the session afterwards.
 * A deleted user reads as not admin.
 */
export async function settleAdminFlag(
	userId: string,
	written: boolean,
	write: (isAdmin: boolean) => Promise<void>
): Promise<void> {
	let last = written;
	for (;;) {
		const result = await query<Pick<User, 'roles'>>('SELECT roles FROM users WHERE id = $1', [userId]);
		const current = result.rows[0] !== undefined && isAdmin(result.rows[0]);
		if (current === last) return;
		await write(current);
		last = current;
	}
}
