/**
 * Migration 030 backfill, run against real Postgres (PGlite, in-process WASM) so the
 * regexes and the collision pass execute exactly as they will in production. Every
 * earlier migration is applied first, the way the runner does it, one transaction per
 * file, then users are seeded and 030 runs over them.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { applyMigration, migratedDb } from './test-support/migrated-db.ts';

const TARGET = '030_user_slugs.sql';

/** Insert a user created `minutesAgo` minutes ago; older rows win collisions. */
async function insertUser(db: PGlite, username: string | null, minutesAgo: number): Promise<void> {
	await db.query(
		`INSERT INTO users (username, email, created_at)
		 VALUES ($1, $2, NOW() - make_interval(mins => $3))`,
		[username, `${username ?? 'pending'}-${minutesAgo}@example.com`, minutesAgo]
	);
}

async function updatedAtById(db: PGlite): Promise<Map<string, string>> {
	const result = await db.query<{ id: string; updated_at: Date }>('SELECT id, updated_at FROM users');
	return new Map(result.rows.map((r) => [r.id, r.updated_at.toISOString()]));
}

describe('030_user_slugs backfill', () => {
	let db: PGlite;
	let slugs: Map<string | null, string | null>;
	let updatedBefore: Map<string, string>;

	beforeAll(async () => {
		db = await migratedDb(TARGET);

		await insertUser(db, 'alice', 100);
		await insertUser(db, 'Jane_Doe', 90);
		// Same default as Jane_Doe once `__` collapses; younger, so it gets suffixed.
		await insertUser(db, 'jane__doe', 80);
		// Natural owner of `jane-doe-2`: the suffix pass must skip it.
		await insertUser(db, 'jane_doe_2', 70);
		// A third claimant of `jane-doe`, after `-2` (natural) and `-3` (jane__doe) are taken.
		await insertUser(db, '_jane_doe_', 60);
		await insertUser(db, '___', 50);
		await insertUser(db, null, 40);

		updatedBefore = await updatedAtById(db);
		await applyMigration(db, TARGET);

		const result = await db.query<{ username: string | null; slug: string | null }>(
			'SELECT username, slug FROM users'
		);
		slugs = new Map(result.rows.map((r) => [r.username, r.slug]));
	}, 60_000);

	afterAll(async () => {
		await db?.close();
	});

	it('lowercases the username and maps underscores to hyphens', () => {
		expect(slugs.get('alice')).toBe('alice');
		expect(slugs.get('Jane_Doe')).toBe('jane-doe');
	});

	it('gives the oldest claimant the bare slug and suffixes the rest', () => {
		expect(slugs.get('jane__doe')).toBe('jane-doe-3');
		expect(slugs.get('_jane_doe_')).toBe('jane-doe-4');
	});

	it('never takes a suffix that is already a natural slug', () => {
		expect(slugs.get('jane_doe_2')).toBe('jane-doe-2');
	});

	it('falls back to "user" when the username has no alphanumerics', () => {
		expect(slugs.get('___')).toBe('user');
	});

	it('leaves users who have not onboarded without a slug', () => {
		expect(slugs.get(null)).toBeNull();
	});

	it('assigns unique slugs', () => {
		const assigned = [...slugs.values()].filter((s): s is string => s !== null);
		expect(new Set(assigned).size).toBe(assigned.length);
	});

	it('does not stamp updated_at on backfilled rows', async () => {
		expect(await updatedAtById(db)).toEqual(updatedBefore);
	});

	it('keeps slug NULL exactly when username is', async () => {
		await expect(
			db.query("INSERT INTO users (username, email) VALUES ('bob', 'bob@example.com')")
		).rejects.toThrow(/users_slug_matches_username/);
		await expect(
			db.query("INSERT INTO users (slug, email) VALUES ('bob', 'bob@example.com')")
		).rejects.toThrow(/users_slug_matches_username/);
	});

	it('rejects a duplicate or malformed slug', async () => {
		await expect(
			db.query("INSERT INTO users (username, slug, email) VALUES ('carol', 'alice', 'carol@example.com')")
		).rejects.toThrow(/idx_users_slug/);
		await expect(
			db.query("INSERT INTO users (username, slug, email) VALUES ('dave', 'Dave_1', 'dave@example.com')")
		).rejects.toThrow(/users_slug_format/);
	});
});
