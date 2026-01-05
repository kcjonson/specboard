/**
 * Password handlers (forgot, reset, change)
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import {
	getSession,
	validatePassword,
	hashPassword,
	verifyPassword,
	generateToken,
	hashToken,
	getTokenExpiry,
	isTokenExpired,
	SESSION_COOKIE_NAME,
} from '@doc-platform/auth';
import { query, type User } from '@doc-platform/db';
import {
	sendEmail,
	getPasswordResetEmailContent,
} from '@doc-platform/email';

import { logAuthEvent, APP_URL } from './utils.js';

interface ForgotPasswordRequest {
	email: string;
}

/**
 * Handle forgot password request
 */
export async function handleForgotPassword(context: Context): Promise<Response> {
	let body: ForgotPasswordRequest;
	try {
		body = await context.req.json<ForgotPasswordRequest>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	const { email } = body;
	if (!email) {
		return context.json({ error: 'Email is required' }, 400);
	}

	// Always return success to prevent email enumeration
	const successResponse = { message: 'If an account exists with this email, a password reset link has been sent.' };

	try {
		// Find user by email
		const userResult = await query<User>(
			'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
			[email]
		);

		const user = userResult.rows[0];
		if (!user) {
			return context.json(successResponse);
		}

		// Don't send reset for inactive accounts
		if (!user.is_active) {
			return context.json(successResponse);
		}

		// Delete any existing reset tokens for this user
		await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);

		// Generate new token
		const token = generateToken();
		const tokenHash = hashToken(token);
		const expiresAt = getTokenExpiry();

		// Store token
		await query(
			'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
			[user.id, tokenHash, expiresAt]
		);

		// Build reset URL
		const resetUrl = `${APP_URL}/reset-password?token=${token}`;

		// Send email
		const emailContent = getPasswordResetEmailContent(resetUrl);
		await sendEmail({
			to: user.email,
			subject: emailContent.subject,
			textBody: emailContent.textBody,
			htmlBody: emailContent.htmlBody,
		});

		return context.json(successResponse);
	} catch (error) {
		console.error('Forgot password failed:', error instanceof Error ? error.message : 'Unknown error');
		// Still return success to prevent enumeration
		return context.json(successResponse);
	}
}

interface ResetPasswordRequest {
	token: string;
	password: string;
}

/**
 * Handle password reset
 */
export async function handleResetPassword(
	context: Context,
	redis: Redis
): Promise<Response> {
	let body: ResetPasswordRequest;
	try {
		body = await context.req.json<ResetPasswordRequest>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	const { token: rawToken, password } = body;
	if (!rawToken || !password) {
		return context.json({ error: 'Token and password are required' }, 400);
	}

	// Sanitize token - remove any non-hex characters (email clients sometimes add invisible Unicode)
	const token = rawToken.replace(/[^a-fA-F0-9]/g, '');
	if (token.length !== 64) {
		return context.json({ error: 'Invalid reset link' }, 400);
	}

	// Validate password
	const passwordValidation = validatePassword(password);
	if (!passwordValidation.valid) {
		return context.json(
			{ error: 'Password does not meet the required complexity. Must be 12+ characters with uppercase, lowercase, digit, and special character.' },
			400
		);
	}

	try {
		const tokenHash = hashToken(token);

		// Find token by hash
		const tokenResult = await query<{
			id: string;
			user_id: string;
			token_hash: string;
			expires_at: Date;
		}>(
			'SELECT * FROM password_reset_tokens WHERE token_hash = $1',
			[tokenHash]
		);

		const tokenRecord = tokenResult.rows[0];
		if (!tokenRecord) {
			return context.json({ error: 'Invalid or expired reset link' }, 400);
		}

		// Check if token has expired
		if (isTokenExpired(new Date(tokenRecord.expires_at))) {
			// Delete expired token
			await query('DELETE FROM password_reset_tokens WHERE id = $1', [tokenRecord.id]);
			return context.json({ error: 'Reset link has expired. Please request a new one.' }, 400);
		}

		// Note: No need for additional token verification here since we looked up
		// the record by tokenHash (line 136). SHA-256 is deterministic, so if the
		// hash matches, the token is correct.

		// Hash new password
		const passwordHash = await hashPassword(password);

		// Update password
		await query(
			'UPDATE user_passwords SET password_hash = $1 WHERE user_id = $2',
			[passwordHash, tokenRecord.user_id]
		);

		// Delete the reset token
		await query('DELETE FROM password_reset_tokens WHERE id = $1', [tokenRecord.id]);

		// Invalidate all existing sessions for this user (force re-login)
		// Use SCAN instead of KEYS to avoid blocking Redis
		let cursor = '0';
		do {
			const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'session:*', 'COUNT', 100);
			cursor = nextCursor;
			for (const key of keys) {
				const sessionData = await redis.get(key);
				if (sessionData) {
					try {
						const session = JSON.parse(sessionData);
						if (session.userId === tokenRecord.user_id) {
							await redis.del(key);
						}
					} catch {
						// Skip invalid session data
					}
				}
			}
		} while (cursor !== '0');

		logAuthEvent('password_reset', { userId: tokenRecord.user_id });

		return context.json({ message: 'Password reset successfully. You can now log in with your new password.' });
	} catch (error) {
		console.error('Password reset failed:', error instanceof Error ? error.message : 'Unknown error');
		return context.json({ error: 'Password reset failed' }, 500);
	}
}

interface ChangePasswordRequest {
	current_password: string;
	new_password: string;
}

/**
 * Handle password change (requires authentication)
 */
export async function handleChangePassword(
	context: Context,
	redis: Redis
): Promise<Response> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);

	if (!sessionId) {
		return context.json({ error: 'Not authenticated' }, 401);
	}

	let body: ChangePasswordRequest;
	try {
		body = await context.req.json<ChangePasswordRequest>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	const { current_password, new_password } = body;
	if (!current_password || !new_password) {
		return context.json({ error: 'Current password and new password are required' }, 400);
	}

	// Validate new password
	const passwordValidation = validatePassword(new_password);
	if (!passwordValidation.valid) {
		return context.json(
			{ error: 'New password does not meet the required complexity. Must be 12+ characters with uppercase, lowercase, digit, and special character.' },
			400
		);
	}

	try {
		const session = await getSession(redis, sessionId);
		if (!session) {
			return context.json({ error: 'Session expired' }, 401);
		}

		// Get current password hash
		const passwordResult = await query<{ password_hash: string }>(
			'SELECT password_hash FROM user_passwords WHERE user_id = $1',
			[session.userId]
		);

		const passwordRecord = passwordResult.rows[0];
		if (!passwordRecord) {
			return context.json({ error: 'User not found' }, 404);
		}

		// Verify current password
		const isCurrentValid = await verifyPassword(current_password, passwordRecord.password_hash);
		if (!isCurrentValid) {
			return context.json({ error: 'Current password is incorrect' }, 401);
		}

		// Hash new password
		const newPasswordHash = await hashPassword(new_password);

		// Update password
		await query(
			'UPDATE user_passwords SET password_hash = $1 WHERE user_id = $2',
			[newPasswordHash, session.userId]
		);

		logAuthEvent('password_changed', { userId: session.userId });

		return context.json({ message: 'Password changed successfully' });
	} catch (error) {
		console.error('Password change failed:', error instanceof Error ? error.message : 'Unknown error');
		return context.json({ error: 'Password change failed' }, 500);
	}
}
