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
		return `postgresql://${user}:${password}@${host}:${port}/${name}`;
	}

	console.error('DATABASE_URL or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD required');
	process.exit(1);
}

async function migrate(): Promise<void> {
	const databaseUrl = getDatabaseUrl();
	const pool = new Pool({ connectionString: databaseUrl });

	try {
		// Create migrations table if it doesn't exist
		await pool.query(`
			CREATE TABLE IF NOT EXISTS schema_migrations (
				name VARCHAR(255) PRIMARY KEY,
				applied_at TIMESTAMPTZ DEFAULT NOW()
			)
		`);

		// Get already applied migrations
		const { rows: applied } = await pool.query<{ name: string }>(
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

			const client = await pool.connect();
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
			} finally {
				client.release();
			}
		}

		if (count === 0) {
			console.log('No pending migrations');
		} else {
			console.log(`Applied ${count} migration(s)`);
		}
	} finally {
		await pool.end();
	}
}

migrate().catch((err) => {
	console.error('Migration failed:', err);
	process.exit(1);
});
