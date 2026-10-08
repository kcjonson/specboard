/**
 * The sync's side of the project's sync lock (docs/specs/project-storage.md, Pulling).
 * The API takes the lock as 'pending'; the sync moves it to 'syncing', and every later
 * write checks the token it got then, so a sync whose lock went stale and was taken
 * over can't write over whoever holds it now.
 */

import { moveSpecLinks, query, transaction, type SpecPathChanges } from '@specboard/db';

/** Move a pending lock to 'syncing'; its token, or null when the lock isn't pending any more. */
export async function markSyncing(projectId: string): Promise<Date | null> {
	const result = await query<{ token: Date }>(
		`UPDATE projects
		 SET sync_status = 'syncing', sync_started_at = date_trunc('milliseconds', clock_timestamp()), sync_error = NULL
		 WHERE id = $1 AND sync_status = 'pending'
		 RETURNING sync_started_at AS token`,
		[projectId]
	);
	return result.rows[0]?.token ?? null;
}

/** Record a failed sync, if this sync still holds the lock. */
export async function markSyncFailed(projectId: string, lock: Date, error: string): Promise<void> {
	await query(
		`UPDATE projects
		 SET sync_status = 'failed', sync_completed_at = NOW(), sync_error = $3
		 WHERE id = $1 AND sync_status = 'syncing' AND sync_started_at = $2`,
		[projectId, lock, error]
	);
}

/**
 * Finish a sync: the sync point moves to `head` and spec links move for what the synced
 * commits renamed and removed, in one transaction, and only if this sync still holds the
 * lock and the sync point is still the `base` it started from (`undefined` for a full
 * sync, which starts from wherever it is). False otherwise; if the lock is still this
 * sync's but the sync point moved, the sync is recorded as failed so a pull can retry.
 */
export async function completeSync(
	projectId: string,
	lock: Date,
	base: string | undefined,
	head: string,
	changes: SpecPathChanges
): Promise<boolean> {
	return transaction(async (client) => {
		const done = await client.query(
			`UPDATE projects
			 SET sync_status = 'completed', sync_completed_at = NOW(), last_synced_commit_sha = $3, sync_error = NULL
			 WHERE id = $1 AND sync_status = 'syncing' AND sync_started_at = $2
			   AND ($4::text IS NULL OR last_synced_commit_sha = $4)
			 RETURNING id`,
			[projectId, lock, head, base ?? null]
		);
		if (done.rows.length === 0) {
			await client.query(
				`UPDATE projects
				 SET sync_status = 'failed', sync_completed_at = NOW(), sync_error = 'The sync point moved during the sync. Pull again.'
				 WHERE id = $1 AND sync_status = 'syncing' AND sync_started_at = $2`,
				[projectId, lock]
			);
			return false;
		}
		await moveSpecLinks(client, projectId, changes);
		return true;
	});
}
