/**
 * Shared database utilities for sync operations.
 */

import { query } from '@doc-platform/db';

/**
 * Update project sync status in the database.
 */
export async function updateSyncStatus(
	projectId: string,
	status: 'pending' | 'syncing' | 'completed' | 'failed',
	commitSha?: string | null,
	error?: string | null
): Promise<void> {
	const now = new Date().toISOString();

	if (status === 'syncing') {
		await query(
			`UPDATE projects
			 SET sync_status = $1, sync_started_at = $2, sync_error = NULL
			 WHERE id = $3`,
			[status, now, projectId]
		);
	} else if (status === 'completed') {
		await query(
			`UPDATE projects
			 SET sync_status = $1, sync_completed_at = $2, last_synced_commit_sha = $3, sync_error = NULL
			 WHERE id = $4`,
			[status, now, commitSha, projectId]
		);
	} else if (status === 'failed') {
		await query(
			`UPDATE projects
			 SET sync_status = $1, sync_completed_at = $2, sync_error = $3
			 WHERE id = $4`,
			[status, now, error, projectId]
		);
	}
}
