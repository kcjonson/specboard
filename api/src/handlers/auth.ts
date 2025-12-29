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
			return context.json({ error: 'Invalid credentials' }, 401);
		}

		// Create session (returns CSRF token)
		const sessionId = generateSessionId();
		const csrfToken = await createSession(redis, sessionId, {
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
			csrfToken,
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
	// Use generic error message to avoid revealing password requirements to attackers
	const passwordValidation = validatePassword(password);
	if (!passwordValidation.valid) {
		return context.json(
			{ error: 'Password does not meet the required complexity. Must be 12+ characters with uppercase, lowercase, digit, and special character.' },
			400
		);
	}

	// Validate names (check trimmed length to catch whitespace-only input)
	const trimmedFirstName = first_name.trim();
	const trimmedLastName = last_name.trim();
	if (!trimmedFirstName || !trimmedLastName) {
		return context.json({ error: 'First name and last name are required' }, 400);
	}
	if (trimmedFirstName.length > 255 || trimmedLastName.length > 255) {
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
			[username.toLowerCase(), trimmedFirstName, trimmedLastName, email.toLowerCase()]
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

		// Create session (log user in immediately, returns CSRF token)
		const sessionId = generateSessionId();
		const csrfToken = await createSession(redis, sessionId, {
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
			csrfToken,
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

		// Build display name from available fields
		const displayName = user.first_name && user.last_name
			? `${user.first_name} ${user.last_name}`
			: user.first_name || user.last_name || user.username || user.email;

		return context.json({
			user: {
				id: user.id,
				username: user.username,
				email: user.email,
				displayName,
				first_name: user.first_name,
				last_name: user.last_name,
				email_verified: user.email_verified,
				phone_number: user.phone_number,
				avatar_url: user.avatar_url,
			},
			csrfToken: session.csrfToken,
		});
	} catch (error) {
		console.error('Failed to get user:', error);
		return context.json({ error: 'Authentication service unavailable' }, 503);
	}
}

interface UpdateMeRequest {
	first_name?: string;
	last_name?: string;
}

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

		// Build update query dynamically
		const updates: string[] = [];
		const values: (string | undefined)[] = [];
		let paramIndex = 1;

		if (first_name !== undefined) {
			updates.push(`first_name = $${paramIndex++}`);
			values.push(first_name.trim());
		}
		if (last_name !== undefined) {
			updates.push(`last_name = $${paramIndex++}`);
			values.push(last_name.trim());
		}

		if (updates.length === 0) {
			return context.json({ error: 'No fields to update' }, 400);
		}

		// Add user ID as last parameter
		values.push(session.userId);

		const userResult = await query<User>(
			`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
			values
		);

		const user = userResult.rows[0];
		if (!user) {
			return context.json({ error: 'User not found' }, 404);
		}

		// Build display name from updated fields
		const displayName = user.first_name && user.last_name
			? `${user.first_name} ${user.last_name}`
			: user.first_name || user.last_name || user.username || user.email;

		return context.json({
			user: {
				id: user.id,
				username: user.username,
				email: user.email,
				displayName,
				first_name: user.first_name,
				last_name: user.last_name,
				email_verified: user.email_verified,
				phone_number: user.phone_number,
				avatar_url: user.avatar_url,
			},
		});
	} catch (error) {
		console.error('Failed to update user:', error);
		return context.json({ error: 'Failed to update profile' }, 500);
	}
}
