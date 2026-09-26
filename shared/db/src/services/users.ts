/**
 * User service - the user slug, the owner half of every project address
 */

import { query } from '../index.ts';

/** The user's slug, or null before onboarding claims one. */
export async function getUserSlug(userId: string): Promise<string | null> {
	const result = await query<{ slug: string | null }>('SELECT slug FROM users WHERE id = $1', [userId]);
	return result.rows[0]?.slug ?? null;
}
