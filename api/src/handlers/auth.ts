/**
 * Auth handlers
 */

import type { Context } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import {
	generateSessionId,
	createSession,
	deleteSession,
	getSession,
	validatePassword,
	hashPassword,
	verifyPassword,
	SESSION_COOKIE_NAME,
	SESSION_TTL_SECONDS,
} from '@doc-platform/auth';
import { query, type User } from '@doc-platform/db';
import { isValidEmail, isValidUsername } from '../validation.js';

interface LoginRequest {
	identifier: string; // username or email
	password: string;
}

interface SignupRequest {
	username: string;
	email: string;
	password: string;
	first_name: string;
	last_name: string;
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
		// Find user by username or email
		const userResult = await query<User & { password_hash: string }>(`
			SELECT u.*, up.password_hash
			FROM users u
			JOIN user_passwords up ON up.user_id = u.id
			WHERE u.username = $1 OR u.email = $1
		`, [identifier.toLowerCase()]);

		const user = userResult.rows[0];
		if (!user) {
			return context.json({ error: 'Invalid credentials' }, 401);
		}

		// Verify password
		const isValid = await verifyPassword(password, user.password_hash);
		if (!isValid) {
			return context.json({ error: 'Invalid credentials' }, 401);
		}

		// Create session
		const sessionId = generateSessionId();
		await createSession(redis, sessionId, {
			userId: user.id,
		});

		setCookie(context, SESSION_COOKIE_NAME, sessionId, {
			httpOnly: true,
			secure: process.env.NODE_ENV === 'production',
			sameSite: 'Lax',
			path: '/',
			maxAge: SESSION_TTL_SECONDS,
		});

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
		console.error('Login failed:', error);
		return context.json({ error: 'Authentication service unavailable' }, 503);
	}
}

/**
 * Handle user signup
 */
export async function handleSignup(
	context: Context,
	redis: Redis
): Promise<Response> {
	let body: SignupRequest;
	try {
		body = await context.req.json<SignupRequest>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	const { username, email, password, first_name, last_name } = body;

	// Validate required fields
	if (!username || !email || !password || !first_name || !last_name) {
		return context.json(
			{ error: 'All fields are required: username, email, password, first_name, last_name' },
			400
		);
	}

	// Validate username
	if (!isValidUsername(username)) {
		return context.json(
			{ error: 'Username must be 3-30 characters, alphanumeric and underscores only' },
			400
		);
	}

	// Validate email
	if (!isValidEmail(email)) {
		return context.json({ error: 'Invalid email format' }, 400);
	}

	// Validate password
	const passwordValidation = validatePassword(password);
	const firstError = passwordValidation.errors[0];
	if (!passwordValidation.valid && firstError) {
		return context.json(
			{ error: firstError.message, errors: passwordValidation.errors },
			400
		);
	}

	// Validate names
	if (first_name.length > 255 || last_name.length > 255) {
		return context.json({ error: 'Name is too long' }, 400);
	}

	try {
		// Check if username exists
		const usernameCheck = await query<{ id: string }>(
			'SELECT id FROM users WHERE username = $1',
			[username.toLowerCase()]
		);
		if (usernameCheck.rows.length > 0) {
			return context.json({ error: 'Username already taken' }, 409);
		}

		// Check if email exists
		const emailCheck = await query<{ id: string }>(
			'SELECT id FROM users WHERE email = $1',
			[email.toLowerCase()]
		);
		if (emailCheck.rows.length > 0) {
			return context.json({ error: 'Email already registered' }, 409);
		}

		// Hash password
		const passwordHash = await hashPassword(password);

		// Create user
		const userResult = await query<User>(
			`INSERT INTO users (username, first_name, last_name, email, email_verified)
			 VALUES ($1, $2, $3, $4, false)
			 RETURNING *`,
			[username.toLowerCase(), first_name.trim(), last_name.trim(), email.toLowerCase()]
		);

		const user = userResult.rows[0];
		if (!user) {
			return context.json({ error: 'Failed to create user' }, 500);
		}

		// Create password record
		await query(
			'INSERT INTO user_passwords (user_id, password_hash) VALUES ($1, $2)',
			[user.id, passwordHash]
		);

		// Create session (log user in immediately)
		const sessionId = generateSessionId();
		await createSession(redis, sessionId, {
			userId: user.id,
		});

		setCookie(context, SESSION_COOKIE_NAME, sessionId, {
			httpOnly: true,
			secure: process.env.NODE_ENV === 'production',
			sameSite: 'Lax',
			path: '/',
			maxAge: SESSION_TTL_SECONDS,
		});

		// TODO: Send verification email

		return context.json({
			user: {
				id: user.id,
				username: user.username,
				email: user.email,
				first_name: user.first_name,
				last_name: user.last_name,
				avatar_url: user.avatar_url,
			},
			message: 'Account created successfully',
		}, 201);
	} catch (error) {
		console.error('Signup failed:', error);
		return context.json({ error: 'Failed to create account' }, 500);
	}
}

/**
 * Handle user logout
 */
export async function handleLogout(
	context: Context,
	redis: Redis
): Promise<Response> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);

	if (sessionId) {
		try {
			await deleteSession(redis, sessionId);
		} catch (error) {
			console.error('Failed to delete session:', error);
		}
	}

	deleteCookie(context, SESSION_COOKIE_NAME, { path: '/' });
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
		console.error('Failed to get user:', error);
		return context.json({ error: 'Authentication service unavailable' }, 503);
	}
}
