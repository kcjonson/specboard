/**
 * Waitlist handler for early access signups
 */

import type { Context } from 'hono';
import type { Redis } from 'ioredis';
import { query } from '@specboard/db';
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

	// Validate email (required) - check type, format, and length
	const email = typeof body.email === 'string' ? body.email : '';
	if (!isValidEmail(email) || email.length > 255) {
		return context.json({ error: 'Valid email is required' }, 400);
	}

	const normalizedEmail = email.toLowerCase().trim();
	const company = sanitizeOptionalString(body.company);
	const role = sanitizeOptionalString(body.role);
	const useCase = sanitizeOptionalString(body.use_case, 2000);

	try {
		// Insert new signup (idempotent: do nothing if email already exists)
		// This avoids race conditions and handles duplicates atomically.
		// RETURNING doubles as the confirmation-email guard: a conflict yields
		// no row, so signing up twice never sends a second thank-you.
		const result = await query<Pick<WaitlistSignup, 'id'>>(
			`INSERT INTO waitlist_signups (email, company, role, use_case)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (email) DO NOTHING
			 RETURNING id`,
			[normalizedEmail, company, role, useCase]
		);

		if (result.rows.length > 0) {
			// Fire-and-forget: the signup is already committed, so a mail
			// failure must not fail the request or roll anything back.
			const emailContent = getWaitlistConfirmationEmailContent();
			sendEmail({
				to: normalizedEmail,
				subject: emailContent.subject,
				textBody: emailContent.textBody,
				htmlBody: emailContent.htmlBody,
				replyTo: emailContent.replyTo,
			}).catch((error) => {
				console.error('Waitlist confirmation email failed:', error instanceof Error ? error.message : 'Unknown error');
			});
		}

		// Always return success (don't leak whether email already existed)
		return context.json({ success: true }, 201);
	} catch (error) {
		console.error('Waitlist signup error:', error);
		return context.json({ error: 'Unable to process signup. Please try again.' }, 500);
	}
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
