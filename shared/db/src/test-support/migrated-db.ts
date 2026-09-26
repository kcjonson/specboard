/**
 * An in-process Postgres (PGlite) with the real migrations applied, for tests whose
 * point is the SQL itself. Each file runs in its own transaction, as the runner does.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const MIGRATIONS_DIR = join(import.meta.dirname, '../../migrations');

export async function applyMigration(db: PGlite, file: string): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'));
	});
}

/** A database migrated up to, but not including, `stopBefore` (every migration when omitted). */
export async function migratedDb(stopBefore?: string): Promise<PGlite> {
	const db = new PGlite({ extensions: { pgcrypto } });
	const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
	for (const file of files) {
		if (file === stopBefore) break;
		await applyMigration(db, file);
	}
	return db;
}
