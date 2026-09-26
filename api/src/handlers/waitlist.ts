/**
 * Waitlist handler for early access signups
 */

import type { Context } from 'hono';
import type { Redis } from 'ioredis';
import { query } from '@specboard/db';
import { sendEmail, getWaitlistConfirmationEmailContent } from '@specboard/email';
import { isValidEmail } from '../validation.ts';
import { getCurrentUser, isAdmin } from './auth-utils.ts';

// Only bounds a crash mid-send. It must outlast any live send, which the SES
// client's request timeout caps at a couple of minutes including retries, or a
// second request could claim the row and send while the first is in flight.
const CONFIRMATION_CLAIM_LEASE = '10 minutes';

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
	// not fail the request. A failure leaves confirmation_sent_at NULL and
	// releases the claim, so submitting the same address again retries the send.
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
	// Claimed with a lease instead of a row lock held across the SES call, so
	// a slow or throttled SES never pins a pool connection; a concurrent
	// submission of the same address finds the lease and stands down. The
	// claim timestamp is the owner token, returned as text because a JS Date
	// drops its microseconds and would never match again.
	const claimed = await query<{ id: string; claim: string }>(
		`UPDATE waitlist_signups SET confirmation_claimed_at = NOW()
		 WHERE email = $1 AND confirmation_sent_at IS NULL
		   AND (confirmation_claimed_at IS NULL OR confirmation_claimed_at < NOW() - $2::interval)
		 RETURNING id, confirmation_claimed_at::text AS claim`,
		[email, CONFIRMATION_CLAIM_LEASE]
	);
	const signup = claimed.rows[0];
	if (!signup) return;

	const emailContent = getWaitlistConfirmationEmailContent();
	let submitted: boolean;
	try {
		submitted = await sendEmail({
			to: email,
			subject: emailContent.subject,
			textBody: emailContent.textBody,
			htmlBody: emailContent.htmlBody,
			replyTo: emailContent.replyTo,
		});
	} catch (sendError) {
		// A failed release must not mask the SES error.
		await releaseClaim(signup.id, signup.claim).catch((releaseError: unknown) => {
			console.error(`Waitlist confirmation claim release failed for ${email}:`, releaseError);
		});
		throw sendError;
	}

	// Console mode, a staging allowlist block, or no SES client: nothing went
	// out, so stamping would stop the address ever getting its confirmation.
	if (!submitted) {
		await releaseClaim(signup.id, signup.claim);
		return;
	}

	// Deliberately not tied to the claim: SES accepted the message, so it went
	// out even if our lease lapsed, and recording that is what stops further
	// sends. The first acceptance keeps its timestamp.
	await query(
		`UPDATE waitlist_signups SET confirmation_sent_at = NOW()
		 WHERE id = $1 AND confirmation_sent_at IS NULL`,
		[signup.id]
	);
}

/**
 * The lease would lapse on its own; releasing it lets the next submission
 * retry now. Matching the token leaves a newer claim alone if ours lapsed
 * mid-send.
 */
async function releaseClaim(id: string, claim: string): Promise<void> {
	await query(
		`UPDATE waitlist_signups SET confirmation_claimed_at = NULL
		 WHERE id = $1 AND confirmation_claimed_at = $2::timestamptz
		   AND confirmation_sent_at IS NULL`,
		[id, claim]
	);
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
