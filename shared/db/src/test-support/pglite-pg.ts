/**
 * A stand-in for the `pg` module that runs every query on one PGlite database, so a
 * test in another package can mock `pg` with it and exercise @specboard/db's real
 * services (query and transaction included) against migrated Postgres:
 *
 *   vi.mock('pg', async () => (await import('@specboard/db/test-support')).pgliteAsPg(() => state.db!));
 *
 * PGlite is one connection, so a "client" from connect() is that same connection and
 * BEGIN/COMMIT on it behave as they would on a pooled client. The pool still reads
 * DATABASE_URL before it is built, so the test sets it to any value.
 */

import type { PGlite } from '@electric-sql/pglite';

interface PgResult {
	rows: unknown[];
	rowCount: number;
}

export interface PgliteAsPg {
	default: { Pool: new () => unknown };
}

export function pgliteAsPg(db: () => PGlite): PgliteAsPg {
	async function run(text: string, params?: unknown[]): Promise<PgResult> {
		const result = await db().query(text, params);
		return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
	}

	class Pool {
		query = run;
		async connect(): Promise<{ query: typeof run; release: () => void }> {
			return { query: run, release: () => {} };
		}
		on(): void {}
		async end(): Promise<void> {}
	}

	return { default: { Pool } };
}
