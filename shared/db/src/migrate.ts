/**
 * Simple migration runner
 * Runs .sql files from migrations/ directory in order
 */

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

const MIGRATIONS_DIR = path.join(import.meta.dirname, '../migrations');

function getDatabaseUrl(): string {
	// Support both DATABASE_URL and individual vars
	if (process.env.DATABASE_URL) {
		return process.env.DATABASE_URL;
	}

	const host = process.env.DB_HOST;
	const port = process.env.DB_PORT || '5432';
	const name = process.env.DB_NAME;
	const user = process.env.DB_USER;
	const password = process.env.DB_PASSWORD;

	if (host && name && user && password) {
		// URL-encode credentials to handle special characters (@, :, /, ?, etc.)
		const encodedUser = encodeURIComponent(user);
		const encodedPassword = encodeURIComponent(password);
		const encodedHost = encodeURIComponent(host);
		const encodedName = encodeURIComponent(name);
		// RDS requires SSL connections (no-verify for RDS CA certificate)
		return `postgresql://${encodedUser}:${encodedPassword}@${encodedHost}:${port}/${encodedName}?sslmode=no-verify`;
	}

	console.error('DATABASE_URL or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD required');
	process.exit(1);
}

async function migrate(): Promise<void> {
	const databaseUrl = getDatabaseUrl();
	const pool = new Pool({ connectionString: databaseUrl });

	// Use a dedicated client for the entire migration run.
	// The advisory lock is session-level — it must stay on the same connection
	// that runs the migrations. pool.query() would release the connection back
	// to the pool where it could be closed by idle timeout.
	const client = await pool.connect();

	try {
		// Acquire advisory lock to prevent concurrent migration execution.
		// If another migration is running (e.g. from a cancelled pipeline that
		// left an ECS task running), this will block until it completes.
		// The lock is released automatically when the client disconnects.
		await client.query(`SELECT pg_advisory_lock(hashtext('specboard-migrations'))`);
		console.log('Acquired migration lock');

		// Create migrations table if it doesn't exist
		await client.query(`
			CREATE TABLE IF NOT EXISTS schema_migrations (
				name VARCHAR(255) PRIMARY KEY,
				applied_at TIMESTAMPTZ DEFAULT NOW()
			)
		`);

		// Get already applied migrations
		const { rows: applied } = await client.query<{ name: string }>(
			'SELECT name FROM schema_migrations ORDER BY name'
		);
		const appliedSet = new Set(applied.map((r) => r.name));

		// Get all migration files
		const files = fs
			.readdirSync(MIGRATIONS_DIR)
			.filter((f) => f.endsWith('.sql'))
			.sort();

		// Run pending migrations
		let count = 0;
		for (const file of files) {
			if (appliedSet.has(file)) {
				continue;
			}

			console.log(`Running migration: ${file}`);
			const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');

			try {
				await client.query('BEGIN');
				await client.query(sql);
				await client.query(
					'INSERT INTO schema_migrations (name) VALUES ($1)',
					[file]
				);
				await client.query('COMMIT');
				console.log(`  ✓ Applied ${file}`);
				count++;
			} catch (err) {
				await client.query('ROLLBACK');
				throw err;
			}
		}

		if (count === 0) {
			console.log('No pending migrations');
		} else {
			console.log(`Applied ${count} migration(s)`);
		}
	} finally {
		client.release();
		await pool.end();
	}
}

migrate().catch((err) => {
	console.error('Migration failed:', err);
	process.exit(1);
});
