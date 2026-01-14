/**
 * Database migration runner for storage service.
 * Can be imported and called, or run directly via CLI.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Run all pending migrations.
 * Creates a new pool connection specifically for migrations.
 */
export async function runMigrations(): Promise<void> {
	const config: pg.PoolConfig = {
		host: process.env.DB_HOST || 'localhost',
		port: Number(process.env.DB_PORT) || 5432,
		database: process.env.DB_NAME || 'storage',
		user: process.env.DB_USER || 'postgres',
		password: process.env.DB_PASSWORD,
	};

	// SSL for AWS RDS (production and staging)
	if (process.env.NODE_ENV !== 'development') {
		const caPath = '/app/rds-ca-bundle.pem';

		if (!fs.existsSync(caPath)) {
			throw new Error(
				`RDS CA bundle not found at "${caPath}". ` +
				'Ensure the CA file is downloaded during image build.'
			);
		}

		let ca: string;
		try {
			ca = fs.readFileSync(caPath, 'utf8');
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(`Failed to read RDS CA bundle: ${message}`);
		}

		config.ssl = {
			rejectUnauthorized: true,
			ca,
		};
	}

	const pool = new Pool(config);

	try {
		// Create migrations tracking table
		await pool.query(`
			CREATE TABLE IF NOT EXISTS schema_migrations (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL UNIQUE,
				applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		// Get list of migration files
		const migrationsDir = path.join(__dirname, 'migrations');
		const files = fs.readdirSync(migrationsDir)
			.filter((f) => f.endsWith('.sql'))
			.sort();

		// Get already applied migrations
		const result = await pool.query<{ name: string }>(
			'SELECT name FROM schema_migrations'
		);
		const applied = new Set(result.rows.map((r) => r.name));

		// Apply new migrations
		for (const file of files) {
			if (applied.has(file)) {
				console.log(`Skipping ${file} (already applied)`);
				continue;
			}

			console.log(`Applying ${file}...`);
			const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

			await pool.query('BEGIN');
			try {
				await pool.query(sql);
				await pool.query(
					'INSERT INTO schema_migrations (name) VALUES ($1)',
					[file]
				);
				await pool.query('COMMIT');
				console.log(`Applied ${file}`);
			} catch (error) {
				await pool.query('ROLLBACK');
				throw error;
			}
		}

		console.log('All migrations applied');
	} finally {
		await pool.end();
	}
}

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	runMigrations().catch((error) => {
		console.error('Migration failed:', error);
		process.exit(1);
	});
}
