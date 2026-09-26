/**
 * Waitlist handler for early access signups
 */

import type { Context } from 'hono';
import type { Redis } from 'ioredis';
import { query, transaction } from '@specboard/db';
import { sendEmail, getWaitlistConfirmationEmailContent } from '@specboard/email';
import { isValidEmail } from '../validation.ts';
import { getCurrentUser, isAdmin } from './auth-utils.ts';

interface WaitlistSignup {
	id: string;
	email: string;
	company: string | null;
	role: string | null;
	use_case: string | null;
	created_at: Date;
}

/**
 * Sanitize optional string field
 */
function sanitizeOptionalString(value: unknown, maxLength: number = 255): string | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value !== 'string') return null;
	return value.trim().slice(0, maxLength);
}

/**
 * Handle waitlist signup
 * POST /api/waitlist
 */
export async function handleWaitlistSignup(context: Context): Promise<Response> {
	// Parse JSON body with explicit error handling
	let body: {
		email?: unknown;
		company?: unknown;
		role?: unknown;
		use_case?: unknown;
	};
	try {
		body = await context.req.json();
	} catch {
		return context.json({ error: 'Invalid JSON' }, 400);
	}

	// Normalize before validating, not after: isValidEmail rejects surrounding
	// whitespace, so validating the raw value would 400 a perfectly good
	// pasted address before the trim below ever ran.
	const email = typeof body.email === 'string' ? body.email : '';
	const normalizedEmail = email.trim().toLowerCase();
	if (!isValidEmail(normalizedEmail) || normalizedEmail.length > 255) {
		return context.json({ error: 'Valid email is required' }, 400);
	}

	const company = sanitizeOptionalString(body.company);
	const role = sanitizeOptionalString(body.role);
	const useCase = sanitizeOptionalString(body.use_case, 2000);

	try {
		// Idempotent: a resubmission leaves the existing row, and its original
		// details, untouched.
		await query(
			`INSERT INTO waitlist_signups (email, company, role, use_case)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (email) DO NOTHING`,
			[normalizedEmail, company, role, useCase]
		);
	} catch (error) {
		console.error('Waitlist signup error:', error);
		return context.json({ error: 'Unable to process signup. Please try again.' }, 500);
	}

	// Fire-and-forget: the signup is already committed, so a mail failure must
	// not fail the request. A failure leaves confirmation_sent_at NULL, so
	// submitting the same address again retries the send.
	sendConfirmationIfUnsent(normalizedEmail).catch((error) => {
		// Log the error whole: the stack and the SES $metadata (request id,
		// error code) are the difference between diagnosing a throttle and
		// guessing.
		console.error(`Waitlist confirmation email failed for ${normalizedEmail}:`, error);
	});

	// Identical whether or not the address was already on the list, so the
	// response can't be used to probe who signed up.
	return context.json({ success: true }, 201);
}

async function sendConfirmationIfUnsent(email: string): Promise<void> {
	await transaction(async (client) => {
		// The row lock is held across the SES call instead of stamping the row
		// up front: if the task dies mid-send the lock goes with the connection
		// and the row stays NULL for the next submission to retry. SKIP LOCKED
		// makes a concurrent submission of the same address stand down rather
		// than send a duplicate.
		const claimed = await client.query<Pick<WaitlistSignup, 'id'>>(
			`SELECT id FROM waitlist_signups
			 WHERE email = $1 AND confirmation_sent_at IS NULL
			 FOR UPDATE SKIP LOCKED`,
			[email]
		);
		const signup = claimed.rows[0];
		if (!signup) return;

		const emailContent = getWaitlistConfirmationEmailContent();
		await sendEmail({
			to: email,
			subject: emailContent.subject,
			textBody: emailContent.textBody,
			htmlBody: emailContent.htmlBody,
			replyTo: emailContent.replyTo,
		});

		await client.query(
			'UPDATE waitlist_signups SET confirmation_sent_at = NOW() WHERE id = $1',
			[signup.id]
		);
	});
}

/**
 * List waitlist signups (admin only)
 * GET /api/waitlist
 */
export async function handleListWaitlist(
	context: Context,
	redis: Redis
): Promise<Response> {
	const currentUser = await getCurrentUser(context, redis);
	if (!currentUser) {
		return context.json({ error: 'Unauthorized' }, 401);
	}

	if (!isAdmin(currentUser)) {
		return context.json({ error: 'Admin access required' }, 403);
	}

	const { search, limit, offset } = context.req.query();

	// Parse pagination
	const limitNum = Math.min(Math.max(parseInt(limit || '50', 10), 1), 100);
	const offsetNum = Math.max(parseInt(offset || '0', 10), 0);

	// Build query with optional search
	const conditions: string[] = [];
	const params: unknown[] = [];
	let paramIndex = 1;

	if (search) {
		conditions.push(`(
			LOWER(email) LIKE LOWER($${paramIndex}) OR
			LOWER(company) LIKE LOWER($${paramIndex}) OR
			LOWER(role) LIKE LOWER($${paramIndex})
		)`);
		params.push(`%${search}%`);
		paramIndex++;
	}

	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

	try {
		const countResult = await query<{ count: string }>(
			`SELECT COUNT(*) as count FROM waitlist_signups ${whereClause}`,
			params
		);
		const total = parseInt(countResult.rows[0]?.count || '0', 10);

		const signupsResult = await query<WaitlistSignup>(
			`SELECT * FROM waitlist_signups ${whereClause}
			 ORDER BY created_at DESC
			 LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
			[...params, limitNum, offsetNum]
		);

		return context.json({
			signups: signupsResult.rows.map(signup => ({
				id: signup.id,
				email: signup.email,
				company: signup.company,
				role: signup.role,
				use_case: signup.use_case,
				created_at: signup.created_at.toISOString(),
			})),
			total,
			limit: limitNum,
			offset: offsetNum,
		});
	} catch (error) {
		console.error('Failed to list waitlist signups:', error);
		return context.json({ error: 'Database error' }, 500);
	}
}
