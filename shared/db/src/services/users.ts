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

/**
 * A person as anyone on a shared project may see them: an actor's user, an item's
 * assignee. Addressed by slug; the user id never leaves the server.
 */
export interface Person {
	/** Null only before onboarding claims one. */
	slug: string | null;
	name: string;
	avatarUrl: string | null;
}

/** Each of these users as a Person, keyed by user id. An id with no user (deleted) is absent. */
export async function getPeople(userIds: Iterable<string>): Promise<Map<string, Person>> {
	const ids = [...new Set(userIds)];
	const people = new Map<string, Person>();
	if (ids.length === 0) return people;
	const result = await query<{ id: string; slug: string | null; name: string; avatar_url: string | null }>(
		`SELECT u.id, u.slug, ${USER_DISPLAY_NAME_SQL} AS name, u.avatar_url FROM users u WHERE u.id = ANY($1::uuid[])`,
		[ids]
	);
	for (const row of result.rows) people.set(row.id, { slug: row.slug, name: row.name, avatarUrl: row.avatar_url });
	return people;
}
