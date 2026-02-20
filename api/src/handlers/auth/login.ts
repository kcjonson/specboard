/**
 * Login handler
 */

import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import {
	generateSessionId,
	createSession,
	verifyPassword,
	SESSION_COOKIE_NAME,
	CSRF_COOKIE_NAME,
	SESSION_TTL_SECONDS,
} from '@specboard/auth';
import { query, type User } from '@specboard/db';

import { logAuthEvent, isSecureRequest } from './utils.ts';

interface LoginRequest {
	identifier: string; // username or email
	password: string;
}

/**
 * Handle user login with username or email
 */
export async function handleLogin(
	context: Context,
	redis: Redis
): Promise<Response> {
	let body: LoginRequest;
	try {
		body = await context.req.json<LoginRequest>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	const { identifier, password } = body;

	if (!identifier || !password) {
		return context.json({ error: 'Username/email and password are required' }, 400);
	}

	try {
		// Find user by username or email (case-insensitive)
		const userResult = await query<User & { password_hash: string }>(`
			SELECT u.*, up.password_hash
			FROM users u
			JOIN user_passwords up ON up.user_id = u.id
			WHERE LOWER(u.username) = LOWER($1) OR LOWER(u.email) = LOWER($1)
		`, [identifier]);

		const user = userResult.rows[0];

		// Perform bcrypt verification regardless of whether user exists
		// This prevents timing attacks that could enumerate valid usernames
		// We use a dummy hash when user doesn't exist to maintain constant time
		const dummyHash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.V4ferE5xGpMSPa';
		const hashToVerify = user?.password_hash ?? dummyHash;
		const isValid = await verifyPassword(password, hashToVerify);

		if (!user || !isValid) {
			logAuthEvent('login_failure', { identifier, reason: 'invalid_credentials' });
			return context.json({ error: 'Invalid credentials' }, 401);
		}

		// Check email verification and account status
		// Return same response for both to prevent account state enumeration
		if (!user.email_verified || !user.is_active) {
			logAuthEvent('login_failure', { identifier, reason: !user.email_verified ? 'email_not_verified' : 'account_inactive' });
			return context.json({
				error: 'Please verify your email address before logging in.',
				email_not_verified: true,
				email: user.email,
			}, 403);
		}

		// Create session (returns CSRF token)
		const sessionId = generateSessionId();
		const csrfToken = await createSession(redis, sessionId, {
			userId: user.id,
		});

		// Set session cookie (HttpOnly - not accessible to JS)
		setCookie(context, SESSION_COOKIE_NAME, sessionId, {
			httpOnly: true,
			secure: isSecureRequest(context),
			sameSite: 'Lax',
			path: '/',
			maxAge: SESSION_TTL_SECONDS,
		});

		// Set CSRF cookie (NOT HttpOnly - JS reads it for double-submit pattern)
		setCookie(context, CSRF_COOKIE_NAME, csrfToken, {
			httpOnly: false,
			secure: isSecureRequest(context),
			sameSite: 'Lax',
			path: '/',
			maxAge: SESSION_TTL_SECONDS,
		});

		logAuthEvent('login_success', { userId: user.id, username: user.username });

		return context.json({
			user: {
				id: user.id,
				username: user.username,
				email: user.email,
				first_name: user.first_name,
				last_name: user.last_name,
				avatar_url: user.avatar_url,
			},
		});
	} catch (error) {
		console.error('Login failed:', error instanceof Error ? error.message : 'Unknown error');
		return context.json({ error: 'Authentication service unavailable' }, 503);
	}
}
