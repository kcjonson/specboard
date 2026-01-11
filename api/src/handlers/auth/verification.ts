/**
 * Email verification handlers
 */

import type { Context } from 'hono';
import {
	generateToken,
	hashToken,
	getTokenExpiry,
	isTokenExpired,
} from '@doc-platform/auth';
import { query, type User } from '@doc-platform/db';
import {
	sendEmail,
	getVerificationEmailContent,
} from '@doc-platform/email';

import { logAuthEvent, APP_URL } from './utils.ts';

interface VerifyEmailRequest {
	token: string;
}

/**
 * Handle email verification
 */
export async function handleVerifyEmail(context: Context): Promise<Response> {
	let body: VerifyEmailRequest;
	try {
		body = await context.req.json<VerifyEmailRequest>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	const { token: rawToken } = body;
	if (!rawToken) {
		return context.json({ error: 'Token is required' }, 400);
	}

	// Sanitize token - remove any non-hex characters (email clients sometimes add invisible Unicode)
	const token = rawToken.replace(/[^a-fA-F0-9]/g, '');
	if (token.length !== 64) {
		return context.json({ error: 'Invalid verification link' }, 400);
	}

	try {
		const tokenHash = hashToken(token);

		// Find token by hash
		const tokenResult = await query<{
			id: string;
			user_id: string;
			email: string;
			token_hash: string;
			expires_at: Date;
		}>(
			'SELECT * FROM email_verification_tokens WHERE token_hash = $1',
			[tokenHash]
		);

		const tokenRecord = tokenResult.rows[0];
		if (!tokenRecord) {
			return context.json({ error: 'Invalid or expired verification link' }, 400);
		}

		// Check if token has expired
		if (isTokenExpired(new Date(tokenRecord.expires_at))) {
			// Delete expired token
			await query('DELETE FROM email_verification_tokens WHERE id = $1', [tokenRecord.id]);
			return context.json({ error: 'Verification link has expired. Please request a new one.' }, 400);
		}

		// Note: No need for additional token verification here since we looked up
		// the record by tokenHash (line 42). SHA-256 is deterministic, so if the
		// hash matches, the token is correct.

		// Mark email as verified
		await query(
			'UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE id = $1',
			[tokenRecord.user_id]
		);

		// Delete the verification token
		await query('DELETE FROM email_verification_tokens WHERE id = $1', [tokenRecord.id]);

		logAuthEvent('email_verified', { userId: tokenRecord.user_id, email: tokenRecord.email });

		return context.json({ message: 'Email verified successfully. You can now log in.' });
	} catch (error) {
		console.error('Email verification failed:', error instanceof Error ? error.message : 'Unknown error');
		return context.json({ error: 'Verification failed' }, 500);
	}
}

interface ResendVerificationRequest {
	email: string;
}

/**
 * Handle resend verification email
 */
export async function handleResendVerification(context: Context): Promise<Response> {
	let body: ResendVerificationRequest;
	try {
		body = await context.req.json<ResendVerificationRequest>();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	const { email } = body;
	if (!email) {
		return context.json({ error: 'Email is required' }, 400);
	}

	// Always return success to prevent email enumeration
	const successResponse = { message: 'If an account exists with this email, a verification link has been sent.' };

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

		// Don't send to inactive accounts
		if (!user.is_active) {
			return context.json(successResponse);
		}

		// If already verified, don't send email
		if (user.email_verified) {
			return context.json(successResponse);
		}

		// Delete any existing verification tokens for this user
		await query('DELETE FROM email_verification_tokens WHERE user_id = $1', [user.id]);

		// Generate new token
		const token = generateToken();
		const tokenHash = hashToken(token);
		const expiresAt = getTokenExpiry();

		// Store token
		await query(
			'INSERT INTO email_verification_tokens (user_id, email, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
			[user.id, user.email, tokenHash, expiresAt]
		);

		// Build verification URL
		const verifyUrl = `${APP_URL}/verify-email/confirm?token=${token}`;

		// Send email - catch failures to log with user context for admin investigation
		try {
			const emailContent = getVerificationEmailContent(verifyUrl);
			await sendEmail({
				to: user.email,
				subject: emailContent.subject,
				textBody: emailContent.textBody,
				htmlBody: emailContent.htmlBody,
			});
		} catch (emailError) {
			// Log with user ID for admin investigation of delivery issues
			console.error('Failed to send verification email:', {
				userId: user.id,
				email: user.email,
				error: emailError instanceof Error ? emailError.message : 'Unknown error',
			});
			// Still return success to prevent enumeration - user can retry
		}

		return context.json(successResponse);
	} catch (error) {
		console.error('Resend verification failed:', error instanceof Error ? error.message : 'Unknown error');
		// Still return success to prevent enumeration
		return context.json(successResponse);
	}
}
