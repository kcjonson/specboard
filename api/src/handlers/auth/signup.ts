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
} from '@specboard/auth';
import { query, type User, type SignupMetadata } from '@specboard/db';
import {
	sendEmail,
	getVerificationEmailContent,
} from '@specboard/email';

import { isValidEmail, isValidUsername } from '../../validation.ts';
import { logAuthEvent, isValidInviteKey, APP_URL } from './utils.ts';

interface SignupRequest {
	username: string;
	email: string;
	password: string;
	first_name: string;
	last_name: string;
	invite_key: string;
	// Optional acquisition tracking
	utm_source?: string;
	utm_medium?: string;
	utm_campaign?: string;
	utm_term?: string;
	utm_content?: string;
	referral_source?: string;
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

	const {
		username, email, password, first_name, last_name, invite_key,
		utm_source, utm_medium, utm_campaign, utm_term, utm_content, referral_source,
	} = body;

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

		// Build signup metadata (only accept strings, truncate to prevent storage abuse)
		const MAX_UTM_LENGTH = 500;
		const sanitize = (val: unknown): string | undefined =>
			typeof val === 'string' && val ? val.slice(0, MAX_UTM_LENGTH) : undefined;

		const signupMetadata: SignupMetadata = { invite_key: invite_key.trim() };
		if (utm_source) signupMetadata.utm_source = sanitize(utm_source);
		if (utm_medium) signupMetadata.utm_medium = sanitize(utm_medium);
		if (utm_campaign) signupMetadata.utm_campaign = sanitize(utm_campaign);
		if (utm_term) signupMetadata.utm_term = sanitize(utm_term);
		if (utm_content) signupMetadata.utm_content = sanitize(utm_content);
		if (referral_source) signupMetadata.referral_source = sanitize(referral_source);

		// Create user
		const userResult = await query<User>(
			`INSERT INTO users (username, first_name, last_name, email, email_verified, signup_metadata)
			 VALUES ($1, $2, $3, $4, false, $5)
			 RETURNING *`,
			[username.toLowerCase(), trimmedFirstName, trimmedLastName, email.toLowerCase(), JSON.stringify(signupMetadata)]
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
