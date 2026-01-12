/**
 * Session handlers (logout, getMe, updateMe)
 */

import type { Context } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import {
	getSession,
	deleteSession,
	SESSION_COOKIE_NAME,
	CSRF_COOKIE_NAME,
} from '@doc-platform/auth';
import { query, type User } from '@doc-platform/db';

import { logAuthEvent } from './utils.ts';

/**
 * Handle user logout
 */
export async function handleLogout(
	context: Context,
	redis: Redis
): Promise<Response> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	let userId: string | undefined;

	if (sessionId) {
		try {
			const session = await getSession(redis, sessionId);
			userId = session?.userId;
			await deleteSession(redis, sessionId);
		} catch (error) {
			console.error('Failed to delete session:', error);
		}
	}

	if (userId) {
		logAuthEvent('logout', { userId });
	}

	deleteCookie(context, SESSION_COOKIE_NAME, { path: '/' });
	deleteCookie(context, CSRF_COOKIE_NAME, { path: '/' });
	return context.json({ success: true });
}

/**
 * Get current user info
 */
export async function handleGetMe(
	context: Context,
	redis: Redis
): Promise<Response> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);

	if (!sessionId) {
		return context.json({ error: 'Not authenticated' }, 401);
	}

	try {
		const session = await getSession(redis, sessionId);
		if (!session) {
			return context.json({ error: 'Session expired' }, 401);
		}

		// Fetch user from database
		const userResult = await query<User>(
			'SELECT * FROM users WHERE id = $1',
			[session.userId]
		);

		const user = userResult.rows[0];
		if (!user) {
			// User was deleted - clear session
			await deleteSession(redis, sessionId);
			deleteCookie(context, SESSION_COOKIE_NAME, { path: '/' });
			return context.json({ error: 'User not found' }, 401);
		}

		// Check if user account is active - invalidate session if deactivated
		if (!user.is_active) {
			await deleteSession(redis, sessionId);
			deleteCookie(context, SESSION_COOKIE_NAME, { path: '/' });
			return context.json({ error: 'Account is deactivated' }, 403);
		}

		return context.json({
			user: {
				id: user.id,
				username: user.username,
				email: user.email,
				first_name: user.first_name,
				last_name: user.last_name,
				email_verified: user.email_verified,
				phone_number: user.phone_number,
				avatar_url: user.avatar_url,
				roles: user.roles,
				is_active: user.is_active,
			},
		});
	} catch (error) {
		console.error('Failed to get user:', error instanceof Error ? error.message : 'Unknown error');
		return context.json({ error: 'Authentication service unavailable' }, 503);
	}
}

interface UpdateMeRequest {
	first_name?: string;
	last_name?: string;
}

/**
 * Allowlist of fields that can be updated via the profile API.
 * SECURITY: Only these exact column names can appear in the UPDATE query.
 * This prevents SQL injection if the pattern is modified or extended.
 */
const ALLOWED_PROFILE_FIELDS = new Set(['first_name', 'last_name']);

/**
 * Update current user profile
 */
export async function handleUpdateMe(
	context: Context,
	redis: Redis
): Promise<Response> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);

	if (!sessionId) {
		return context.json({ error: 'Not authenticated' }, 401);
	}

	let body: UpdateMeRequest;
	try {
		body = await context.req.json<UpdateMeRequest>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	const { first_name, last_name } = body;

	// Validate names if provided
	if (first_name !== undefined) {
		const trimmed = first_name.trim();
		if (!trimmed) {
			return context.json({ error: 'First name cannot be empty' }, 400);
		}
		if (trimmed.length > 255) {
			return context.json({ error: 'First name is too long' }, 400);
		}
	}

	if (last_name !== undefined) {
		const trimmed = last_name.trim();
		if (!trimmed) {
			return context.json({ error: 'Last name cannot be empty' }, 400);
		}
		if (trimmed.length > 255) {
			return context.json({ error: 'Last name is too long' }, 400);
		}
	}

	try {
		const session = await getSession(redis, sessionId);
		if (!session) {
			return context.json({ error: 'Session expired' }, 401);
		}

		// Check if user is still active before allowing updates
		const checkResult = await query<{ is_active: boolean }>(
			'SELECT is_active FROM users WHERE id = $1',
			[session.userId]
		);
		const currentUser = checkResult.rows[0];
		if (!currentUser || !currentUser.is_active) {
			await deleteSession(redis, sessionId);
			deleteCookie(context, SESSION_COOKIE_NAME, { path: '/' });
			return context.json({ error: 'Account is deactivated' }, 403);
		}

		// Build update query from allowlisted fields only
		// SECURITY: Field names are validated against ALLOWED_PROFILE_FIELDS
		// before being interpolated into SQL. Values are always parameterized.
		const fieldsToUpdate: Array<{ field: string; value: string }> = [];

		if (first_name !== undefined && ALLOWED_PROFILE_FIELDS.has('first_name')) {
			fieldsToUpdate.push({ field: 'first_name', value: first_name.trim() });
		}
		if (last_name !== undefined && ALLOWED_PROFILE_FIELDS.has('last_name')) {
			fieldsToUpdate.push({ field: 'last_name', value: last_name.trim() });
		}

		if (fieldsToUpdate.length === 0) {
			return context.json({ error: 'No fields to update' }, 400);
		}

		// Build parameterized query with allowlisted field names
		const setClauses = fieldsToUpdate.map((f, i) => `${f.field} = $${i + 1}`);
		const values = [...fieldsToUpdate.map(f => f.value), session.userId];
		const userIdParam = fieldsToUpdate.length + 1;

		const userResult = await query<User>(
			`UPDATE users SET ${setClauses.join(', ')} WHERE id = $${userIdParam} RETURNING *`,
			values
		);

		const user = userResult.rows[0];
		if (!user) {
			return context.json({ error: 'User not found' }, 404);
		}

		return context.json({
			user: {
				id: user.id,
				username: user.username,
				email: user.email,
				first_name: user.first_name,
				last_name: user.last_name,
				email_verified: user.email_verified,
				phone_number: user.phone_number,
				avatar_url: user.avatar_url,
			},
		});
	} catch (error) {
		console.error('Failed to update user:', error instanceof Error ? error.message : 'Unknown error');
		return context.json({ error: 'Failed to update profile' }, 500);
	}
}
