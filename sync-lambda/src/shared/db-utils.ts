/**
 * Shared database utilities for sync operations.
 *
 * Uses lazy initialization for the database pool because Lambda needs to
 * fetch DB credentials from Secrets Manager before the connection can be made.
 */

import pg from 'pg';

const { Pool } = pg;

// Lazy-initialized pool - created on first use after env vars are set
let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
	if (!pool) {
		const host = process.env.DB_HOST;
		const port = process.env.DB_PORT || '5432';
		const name = process.env.DB_NAME;
		const user = process.env.DB_USER;
		const password = process.env.DB_PASSWORD;

		if (!host || !name || !user || !password) {
			throw new Error('Database environment variables not set');
		}

		const connectionString = `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${name}`;

		pool = new Pool({
			connectionString,
			max: 5,
			idleTimeoutMillis: 30000,
			connectionTimeoutMillis: 5000,
			ssl: { rejectUnauthorized: false },
		});
	}
	return pool;
}

async function query<T extends pg.QueryResultRow>(
	text: string,
	params?: unknown[]
): Promise<pg.QueryResult<T>> {
	return getPool().query<T>(text, params);
}

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
