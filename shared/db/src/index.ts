import pg from 'pg';

export * from './types.js';
export * from './services/index.js';

const { Pool } = pg;

// Build DATABASE_URL from individual vars if not provided
function getDatabaseUrl(): string {
	if (process.env.DATABASE_URL) {
		return process.env.DATABASE_URL;
	}

	const host = process.env.DB_HOST;
	const port = process.env.DB_PORT || '5432';
	const name = process.env.DB_NAME;
	const user = process.env.DB_USER;
	const password = process.env.DB_PASSWORD;

	if (host && name && user && password) {
		return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
	}

	throw new Error(
		'DATABASE_URL or all of DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD are required (DB_PORT optional, defaults to 5432)'
	);
}

const connectionString = getDatabaseUrl();

// Connection pool - reused across requests
const pool = new Pool({
	connectionString,
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
