/**
 * Session handlers (logout, getMe, updateMe)
 */

import type { Context } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import {
	getSession,
	updateSession,
	deleteSession,
	SESSION_COOKIE_NAME,
	CSRF_COOKIE_NAME,
} from '@specboard/auth';
import { query, type User } from '@specboard/db';

import { isValidUsername } from '../../validation.ts';
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

		// Fetch user plus password presence and passkey count (onboarding needs them)
		const userResult = await query<User & { has_password: boolean; passkey_count: string }>(
			`SELECT u.*,
				(up.user_id IS NOT NULL) AS has_password,
				(SELECT COUNT(*) FROM webauthn_credentials wc WHERE wc.user_id = u.id) AS passkey_count
			 FROM users u
			 LEFT JOIN user_passwords up ON up.user_id = u.id
			 WHERE u.id = $1`,
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

		// Heal a stale onboarding flag: a session created before the profile
		// was completed (e.g. a second device signed in mid-onboarding, or an
		// admin set the username) keeps profileComplete=false and would be
		// bounced to /onboarding on every document load until this refresh.
		const profileComplete = user.username !== null;
		if (profileComplete && session.profileComplete === false) {
			await updateSession(redis, sessionId, { profileComplete: true });
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
				has_password: user.has_password,
				passkey_count: Number(user.passkey_count),
				profile_complete: profileComplete,
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
	/** Claimable exactly once, while still NULL from email-only signup */
	username?: string;
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

	const { first_name, last_name, username } = body;

	// typeof guard first: isValidUsername coerces non-strings, and a later
	// .toLowerCase() on a non-string would throw a 500
	if (username !== undefined && (typeof username !== 'string' || !isValidUsername(username))) {
		return context.json(
			{ error: 'Username must be 3-30 characters, alphanumeric and underscores only' },
			400
		);
	}

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

		// Onboarding username claim: set username AND names in one atomic
		// statement, guarded by `username IS NULL` so it's settable exactly
		// once. Doing it as a single UPDATE (rather than claim-then-names)
		// means a failure can't leave a claimed username with unsaved names,
		// which would trap a resubmit on the "already set" 409. The session
		// flag is flipped only after the write commits.
		if (username !== undefined) {
			const firstTrimmed = typeof first_name === 'string' ? first_name.trim() : '';
			const lastTrimmed = typeof last_name === 'string' ? last_name.trim() : '';
			if (!firstTrimmed || !lastTrimmed) {
				return context.json({ error: 'First name and last name are required' }, 400);
			}
			try {
				const claim = await query<User>(
					`UPDATE users SET username = $1, first_name = $2, last_name = $3
					 WHERE id = $4 AND username IS NULL
					 RETURNING *`,
					[username.toLowerCase(), firstTrimmed, lastTrimmed, session.userId]
				);
				if ((claim.rowCount ?? 0) === 0) {
					return context.json({ error: 'Username is already set and cannot be changed' }, 409);
				}
				// Unblock the frontend onboarding redirect for this session.
				await updateSession(redis, sessionId, { profileComplete: true });
				const user = claim.rows[0]!;
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
			} catch (claimError) {
				if (claimError instanceof Error && 'code' in claimError && claimError.code === '23505') {
					return context.json({ error: 'Username already taken' }, 409);
				}
				throw claimError;
			}
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
