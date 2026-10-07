/**
 * User service - the user slug, the owner half of every project address
 */

import { query } from '../index.ts';

/** The user's slug, or null before onboarding claims one. */
export async function getUserSlug(userId: string): Promise<string | null> {
	const result = await query<{ slug: string | null }>('SELECT slug FROM users WHERE id = $1', [userId]);
	return result.rows[0]?.slug ?? null;
}

/**
 * SQL for a user's display name, over a `users` row aliased `u`: their full name, else
 * their username, else their email (an account that hasn't onboarded has neither).
 */
export const USER_DISPLAY_NAME_SQL =
	"COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.username, u.email)";
