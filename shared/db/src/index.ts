import pg from 'pg';

export * from './types.js';
export * from './services/index.js';

const { Pool } = pg;

// Validate DATABASE_URL is set
if (!process.env.DATABASE_URL) {
	throw new Error('DATABASE_URL environment variable is required');
}

// Connection pool - reused across requests
const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	max: 20,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 2000,
});

// Log connection errors (don't crash the server)
pool.on('error', (err) => {
	console.error('Unexpected database error:', err);
});

/**
 * Execute a query with parameters
 */
export async function query<T extends pg.QueryResultRow>(
	text: string,
	params?: unknown[]
): Promise<pg.QueryResult<T>> {
	const start = Date.now();
	const result = await pool.query<T>(text, params);
	const duration = Date.now() - start;

	if (process.env.NODE_ENV === 'development') {
		console.log('query', { text, duration, rows: result.rowCount });
	}

	return result;
}

/**
 * Get a client from the pool for transactions
 */
export async function getClient(): Promise<pg.PoolClient> {
	return pool.connect();
}

/**
 * Execute a transaction
 */
export async function transaction<T>(
	fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const result = await fn(client);
		await client.query('COMMIT');
		return result;
	} catch (e) {
		await client.query('ROLLBACK');
		throw e;
	} finally {
		client.release();
	}
}

/**
 * Close all connections (for graceful shutdown)
 */
export async function close(): Promise<void> {
	await pool.end();
}

export { pool };
