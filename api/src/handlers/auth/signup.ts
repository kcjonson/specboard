/**
 * Signup handler
 */

import type { Context } from 'hono';
import {
	validatePassword,
	hashPassword,
	generateToken,
	hashToken,
	getTokenExpiry,
} from '@doc-platform/auth';
import { query, type User } from '@doc-platform/db';
import {
	sendEmail,
	getVerificationEmailContent,
} from '@doc-platform/email';

import { isValidEmail, isValidUsername } from '../../validation.ts';
import { logAuthEvent, isValidInviteKey, APP_URL } from './utils.ts';

interface SignupRequest {
	username: string;
	email: string;
	password: string;
	first_name: string;
	last_name: string;
	invite_key: string;
}

/**
 * Handle user signup
 */
export async function handleSignup(context: Context): Promise<Response> {
	let body: SignupRequest;
	try {
		body = await context.req.json<SignupRequest>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	const { username, email, password, first_name, last_name, invite_key } = body;

	// Validate required fields
	if (!username || !email || !password || !first_name || !last_name || !invite_key) {
		return context.json(
			{ error: 'All fields are required: username, email, password, first_name, last_name, invite_key' },
			400
		);
	}

	// Validate invite key
	if (!isValidInviteKey(invite_key)) {
		return context.json({ error: 'Invalid invite key' }, 403);
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

		// Check if email exists (case-insensitive)
		const emailCheck = await query<{ id: string }>(
			'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
			[email]
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

		// Generate verification token
		const token = generateToken();
		const tokenHash = hashToken(token);
		const expiresAt = getTokenExpiry();

		// Store verification token
		await query(
			'INSERT INTO email_verification_tokens (user_id, email, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
			[user.id, user.email, tokenHash, expiresAt]
		);

		// Build verification URL
		const verifyUrl = `${APP_URL}/verify-email/confirm?token=${token}`;

		// Send verification email
		// If this fails, the user can use the resend verification flow
		try {
			const emailContent = getVerificationEmailContent(verifyUrl);
			await sendEmail({
				to: user.email,
				subject: emailContent.subject,
				textBody: emailContent.textBody,
				htmlBody: emailContent.htmlBody,
			});
		} catch (emailError) {
			console.error('Failed to send verification email:', emailError instanceof Error ? emailError.message : 'Unknown error');
			// Still return success - user can resend verification email
		}

		logAuthEvent('signup_success', { userId: user.id, username: user.username });

		// Do NOT log user in - they must verify email first
		return context.json({
			message: 'Account created! Please check your email to verify your account before logging in.',
			email: user.email,
		}, 201);
	} catch (error) {
		// Handle unique constraint violations (race condition between check and insert)
		if (error instanceof Error && 'code' in error && error.code === '23505') {
			// PostgreSQL unique_violation error
			const detail = 'detail' in error ? String(error.detail) : '';
			if (detail.includes('username')) {
				return context.json({ error: 'Username already taken' }, 409);
			}
			if (detail.includes('email')) {
				return context.json({ error: 'Email already registered' }, 409);
			}
			// Generic fallback for other unique constraint violations
			return context.json({ error: 'Account already exists' }, 409);
		}
		console.error('Signup failed:', error instanceof Error ? error.message : 'Unknown error');
		return context.json({ error: 'Failed to create account' }, 500);
	}
}
