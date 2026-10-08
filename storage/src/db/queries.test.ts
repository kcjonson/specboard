/**
 * Where a pending change was renamed from, as the storage schema keeps it (real
 * Postgres via PGlite, with this service's migrations): set by the rename, kept through
 * later saves that don't name one, and cleared by a deletion.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { PGlite, type Transaction } from '@electric-sql/pglite';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

vi.mock('./index.ts', () => ({
	pool: { instance: { query: (text: string, params?: unknown[]) => state.db!.query(text, params) } },
	transaction: <T>(fn: (client: Transaction) => Promise<T>) => state.db!.transaction(fn),
}));

import { getPendingChange, listPendingChanges, promoteCommit, rebasePendingChanges, upsertPendingChange, upsertProjectDocument } from './queries.ts';

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
	await state.db!.query('DELETE FROM project_documents');
});

/** Someone's commit (or a pull) putting a version of a file into the committed files. */
async function commitVersion(path: string, hash: string): Promise<void> {
	await upsertProjectDocument(PROJECT, path, `${PROJECT}/files/${path}`, hash, 1);
}

async function listed(path: string): Promise<{ baseContentHash: string | null; conflict: boolean; action: string } | undefined> {
	return (await listPendingChanges(PROJECT, USER)).find((c) => c.path === path);
}

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

describe('a draft\'s base and its conflicts', () => {
	it('takes the committed hash when the row is first written, and keeps it through later saves', async () => {
		await commitVersion('docs/a.md', 'v1');
		await upsertPendingChange(PROJECT, USER, 'docs/a.md', '# Mine', null, 'modified', null);
		await commitVersion('docs/a.md', 'v2');
		await upsertPendingChange(PROJECT, USER, 'docs/a.md', '# Mine, more', null, 'modified', null);

		expect(await listed('docs/a.md')).toMatchObject({ baseContentHash: 'v1', conflict: true });
	});

	it('has no conflict while the committed file is the one the draft began from', async () => {
		await commitVersion('docs/a.md', 'v1');
		await upsertPendingChange(PROJECT, USER, 'docs/a.md', '# Mine', null, 'modified', null);

		expect(await listed('docs/a.md')).toMatchObject({ baseContentHash: 'v1', conflict: false });
	});

	it('counts a created draft once a file is committed at its path', async () => {
		await upsertPendingChange(PROJECT, USER, 'docs/new.md', '# Mine', null, 'created', null);
		expect(await listed('docs/new.md')).toMatchObject({ baseContentHash: null, conflict: false });

		await commitVersion('docs/new.md', 'theirs');

		expect(await listed('docs/new.md')).toMatchObject({ conflict: true });
	});

	it('counts a deletion of a file that changed, and of one already gone', async () => {
		await commitVersion('docs/a.md', 'v1');
		await commitVersion('docs/b.md', 'v1');
		await upsertPendingChange(PROJECT, USER, 'docs/a.md', null, null, 'deleted', null);
		await upsertPendingChange(PROJECT, USER, 'docs/b.md', null, null, 'deleted', null);
		await commitVersion('docs/a.md', 'v2');
		await state.db!.query("DELETE FROM project_documents WHERE path = 'docs/b.md'");

		expect(await listed('docs/a.md')).toMatchObject({ conflict: true });
		expect(await listed('docs/b.md')).toMatchObject({ conflict: true });
	});

	it('re-bases kept drafts on what\'s committed now, and drops a deletion with nothing left to delete', async () => {
		await commitVersion('docs/a.md', 'v1');
		await commitVersion('docs/b.md', 'v1');
		await upsertPendingChange(PROJECT, USER, 'docs/a.md', '# Mine', null, 'modified', null);
		await upsertPendingChange(PROJECT, USER, 'docs/b.md', null, null, 'deleted', null);
		await upsertPendingChange(PROJECT, USER, 'docs/c.md', '# Mine', null, 'created', null);
		await state.db!.query("DELETE FROM project_documents WHERE path IN ('docs/a.md', 'docs/b.md')");
		await commitVersion('docs/c.md', 'theirs');

		expect(await rebasePendingChanges(PROJECT, USER, ['docs/a.md', 'docs/b.md', 'docs/c.md'])).toEqual({
			rebased: ['docs/a.md', 'docs/c.md'],
			dropped: ['docs/b.md'],
		});
		expect(await listed('docs/a.md')).toMatchObject({ baseContentHash: null, conflict: false, action: 'created' });
		expect(await listed('docs/c.md')).toMatchObject({ baseContentHash: 'theirs', conflict: false, action: 'modified' });
		expect(await listed('docs/b.md')).toBeUndefined();
	});

	it('re-bases the committer\'s draft saved mid-commit on what they just committed', async () => {
		await commitVersion('docs/a.md', 'v1');
		await upsertPendingChange(PROJECT, USER, 'docs/a.md', '# Committed', null, 'modified', null);
		const read = (await listPendingChanges(PROJECT, USER))[0]!.updatedAt.toISOString();
		await new Promise((resolve) => setTimeout(resolve, 5));
		await upsertPendingChange(PROJECT, USER, 'docs/a.md', '# Saved during the commit', null, 'modified', null);

		await promoteCommit(
			PROJECT,
			USER,
			[{ path: 'docs/a.md', s3Key: `${PROJECT}/files/docs/a.md`, contentHash: 'v2', sizeBytes: 1 }],
			[],
			[{ path: 'docs/a.md', updatedAt: read }]
		);

		expect(await listed('docs/a.md')).toMatchObject({ baseContentHash: 'v2', conflict: false });
	});
});

describe('the base a writer gives', () => {
	it('is used on the first write instead of what\'s committed then', async () => {
		await commitVersion('docs/a.md', 'v2');
		// The editor loaded v1, someone committed v2, then the first save arrives.
		await upsertPendingChange(PROJECT, USER, 'docs/a.md', '# Mine', null, 'modified', null, { given: true, hash: 'v1' }, 'mine');

		expect(await listed('docs/a.md')).toMatchObject({ baseContentHash: 'v1', conflict: true });
	});

	it('records a null base as "nothing was committed here"', async () => {
		await commitVersion('docs/new.md', 'theirs');
		await upsertPendingChange(PROJECT, USER, 'docs/new.md', '# Mine', null, 'created', null, { given: true, hash: null }, 'mine');

		expect(await listed('docs/new.md')).toMatchObject({ baseContentHash: null, conflict: true });
	});

	it('doesn\'t replace the base of a draft that already has one', async () => {
		await commitVersion('docs/a.md', 'v1');
		await upsertPendingChange(PROJECT, USER, 'docs/a.md', '# Mine', null, 'modified', null, { given: true, hash: 'v1' }, 'mine');
		await upsertPendingChange(PROJECT, USER, 'docs/a.md', '# Mine, more', null, 'modified', null, { given: true, hash: 'v9' }, 'mine2');

		expect(await listed('docs/a.md')).toMatchObject({ baseContentHash: 'v1' });
	});

	it('isn\'t a conflict when the draft holds exactly what\'s committed now', async () => {
		await commitVersion('docs/a.md', 'v1');
		await upsertPendingChange(PROJECT, USER, 'docs/a.md', '# Mine', null, 'modified', null, { given: true, hash: 'v1' }, 'mine');
		// The committer's own commit came back in through a pull after its promotion failed.
		await commitVersion('docs/a.md', 'mine');

		expect(await listed('docs/a.md')).toMatchObject({ conflict: false });
	});
});

describe('migration 003 on drafts from before it', () => {
	it('gives each existing draft today\'s committed hash as its base, and flags one whose file is gone', async () => {
		const db = new PGlite();
		const dir = join(import.meta.dirname, 'migrations');
		const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
		for (const file of files.filter((f) => f < '003')) {
			await db.exec(readFileSync(join(dir, file), 'utf-8'));
		}
		await db.query(
			"INSERT INTO project_documents (project_id, path, s3_key, content_hash, size_bytes) VALUES ($1, 'docs/a.md', 'k', 'v1', 1)",
			[PROJECT]
		);
		await db.query(
			`INSERT INTO pending_changes (project_id, user_id, path, content, action) VALUES
			 ($1, $2, 'docs/a.md', '# Mine', 'modified'), ($1, $2, 'docs/new.md', '# Mine', 'created'),
			 ($1, $2, 'docs/lost.md', '# Mine', 'modified')`,
			[PROJECT, USER]
		);

		await db.exec(readFileSync(join(dir, files.find((f) => f.startsWith('003'))!), 'utf-8'));

		const rows = await db.query<{ path: string; base_content_hash: string | null }>(
			'SELECT path, base_content_hash FROM pending_changes ORDER BY path'
		);
		expect(rows.rows).toEqual([
			{ path: 'docs/a.md', base_content_hash: 'v1' },
			// Edits a file that isn't committed any more: flagged.
			{ path: 'docs/lost.md', base_content_hash: 'missing-before-migration' },
			{ path: 'docs/new.md', base_content_hash: null },
		]);
		await db.close();
	}, 60_000);
});

