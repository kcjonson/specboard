/**
 * Database connection pool for storage service.
 * Uses separate database from main app to isolate file workload.
 * Pool is lazily initialized on first use.
 */

import fs from 'fs';
import pg from 'pg';

const { Pool } = pg;

let _pool: pg.Pool | null = null;

function createPool(): pg.Pool {
	const config: pg.PoolConfig = {
		host: process.env.DB_HOST || 'localhost',
		port: Number(process.env.DB_PORT) || 5432,
		database: process.env.DB_NAME || 'storage',
		user: process.env.DB_USER || 'postgres',
		password: process.env.DB_PASSWORD,
		max: 10,
		idleTimeoutMillis: 30000,
		connectionTimeoutMillis: 5000,
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

	const newPool = new Pool(config);

	newPool.on('error', (err) => {
		console.error('Unexpected database pool error:', err);
	});

	console.log('Database pool initialized');
	return newPool;
}

/**
 * Database pool with lazy initialization.
 * Access via pool.instance - creates connection on first use.
 */
export const pool = {
	get instance(): pg.Pool {
		if (!_pool) {
			_pool = createPool();
		}
		return _pool;
	},
};

export async function closeDb(): Promise<void> {
	if (_pool) {
		await _pool.end();
		_pool = null;
		console.log('Database pool closed');
	}
}
