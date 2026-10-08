/**
 * Where a pending change was renamed from, as the storage schema keeps it (real
 * Postgres via PGlite, with this service's migrations): set by the rename, kept through
 * later saves that don't name one, and cleared by a deletion.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

vi.mock('./index.ts', () => ({
	pool: { instance: { query: (text: string, params?: unknown[]) => state.db!.query(text, params) } },
}));

import { getPendingChange, listPendingChanges, upsertPendingChange } from './queries.ts';

const PROJECT = '00000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-000000000002';

async function renamedFrom(path: string): Promise<string | null | undefined> {
	return (await getPendingChange(PROJECT, USER, path))?.renamedFrom;
}

beforeAll(async () => {
	const db = new PGlite();
	const dir = join(import.meta.dirname, 'migrations');
	for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
		await db.exec(readFileSync(join(dir, file), 'utf-8'));
	}
	state.db = db;
}, 60_000);

beforeEach(async () => {
	await state.db!.query('DELETE FROM pending_changes');
});

afterAll(async () => {
	await state.db?.close();
});

describe('upsertPendingChange and renamedFrom', () => {
	it('records the origin a rename gives and lists it', async () => {
		await upsertPendingChange(PROJECT, USER, 'docs/new.md', '# Doc', null, 'created', 'docs/old.md');

		expect(await renamedFrom('docs/new.md')).toBe('docs/old.md');
		expect((await listPendingChanges(PROJECT, USER))[0]).toMatchObject({ path: 'docs/new.md', renamedFrom: 'docs/old.md' });
	});

	it('keeps the origin through a later save that names none', async () => {
		await upsertPendingChange(PROJECT, USER, 'docs/new.md', '# Doc', null, 'created', 'docs/old.md');
		await upsertPendingChange(PROJECT, USER, 'docs/new.md', '# Edited', null, 'created', null);

		expect(await renamedFrom('docs/new.md')).toBe('docs/old.md');
		expect((await getPendingChange(PROJECT, USER, 'docs/new.md'))?.content).toBe('# Edited');
	});

	it('takes a new origin when a write names one', async () => {
		await upsertPendingChange(PROJECT, USER, 'docs/b.md', '# Doc', null, 'modified', 'docs/a.md');
		await upsertPendingChange(PROJECT, USER, 'docs/b.md', '# Doc', null, 'modified', 'docs/c.md');

		expect(await renamedFrom('docs/b.md')).toBe('docs/c.md');
	});

	it('gives a deletion no origin, even over one that had it', async () => {
		await upsertPendingChange(PROJECT, USER, 'docs/b.md', '# Doc', null, 'modified', 'docs/a.md');
		await upsertPendingChange(PROJECT, USER, 'docs/b.md', null, null, 'deleted', null);
		await upsertPendingChange(PROJECT, USER, 'docs/c.md', null, null, 'deleted', 'docs/a.md');

		expect(await renamedFrom('docs/b.md')).toBeNull();
		expect(await renamedFrom('docs/c.md')).toBeNull();
	});
});
