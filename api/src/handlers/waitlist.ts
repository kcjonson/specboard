/**
 * Waitlist handler for early access signups
 */

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { getSession, SESSION_COOKIE_NAME } from '@doc-platform/auth';
import { query, type User } from '@doc-platform/db';

interface WaitlistSignup {
	id: string;
	email: string;
	company: string | null;
	role: string | null;
	use_case: string | null;
	created_at: Date;
}

/**
 * Validate email format
 */
function isValidEmail(email: unknown): email is string {
	if (typeof email !== 'string') return false;
	// Basic email validation - checks for @ and domain
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return emailRegex.test(email) && email.length <= 255;
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
	try {
		const body = await context.req.json<{
			email?: unknown;
			company?: unknown;
			role?: unknown;
			use_case?: unknown;
		}>();

		// Validate email (required)
		if (!isValidEmail(body.email)) {
			return context.json({ error: 'Valid email is required' }, 400);
		}

		const email = body.email.toLowerCase().trim();
		const company = sanitizeOptionalString(body.company);
		const role = sanitizeOptionalString(body.role);
		const useCase = sanitizeOptionalString(body.use_case, 2000);

		// Check for existing signup
		const existing = await query<{ id: string }>(
			'SELECT id FROM waitlist_signups WHERE email = $1',
			[email]
		);

		if (existing.rows.length > 0) {
			// Already signed up - return success anyway (don't leak info)
			return context.json({ success: true }, 201);
		}

		// Insert new signup
		await query<WaitlistSignup>(
			`INSERT INTO waitlist_signups (email, company, role, use_case)
			 VALUES ($1, $2, $3, $4)`,
			[email, company, role, useCase]
		);

		return context.json({ success: true }, 201);
	} catch (error) {
		console.error('Waitlist signup error:', error);
		return context.json({ error: 'Unable to process signup. Please try again.' }, 500);
	}
}

/**
 * Get current user from session
 */
async function getCurrentUser(context: Context, redis: Redis): Promise<User | null> {
	const sessionId = getCookie(context, SESSION_COOKIE_NAME);
	if (!sessionId) return null;

	const session = await getSession(redis, sessionId);
	if (!session) return null;

	const result = await query<User>(
		'SELECT * FROM users WHERE id = $1',
		[session.userId]
	);

	const user = result.rows[0];
	if (!user || !user.is_active) return null;

	return user;
}

/**
 * Check if user has admin role
 */
function isAdmin(user: User): boolean {
	return user.roles.includes('admin');
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
