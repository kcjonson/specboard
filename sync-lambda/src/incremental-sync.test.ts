/**
 * Incremental sync against real @specboard/db on migrated Postgres (PGlite); GitHub's
 * ref, compare, and blob endpoints are stubbed, and so is the storage service.
 *
 * The sync point it stores is the branch head as a full SHA (the only form GitHub's
 * commit API takes back), it moves spec links for what the pulled commits renamed and
 * removed together with that sync point, it falls back to a full sync when the compare
 * can't list everything, and it changes nothing when its lock or base isn't current.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

vi.mock('pg', async () => (await import('@specboard/db/test-support')).pgliteAsPg(() => state.db!));

const storage = vi.hoisted(() => ({
	putFile: vi.fn(async (_projectId: string, _path: string, _content: string) => {}),
	deleteFile: vi.fn(async (_projectId: string, _path: string) => {}),
	listFiles: vi.fn(async (_projectId: string) => [] as string[]),
	markUnavailable: vi.fn(async (_projectId: string, _path: string, _reason: string, _hash: string, _size: number) => {}),
}));

vi.mock('./shared/storage-client.ts', () => ({ createStorageClient: () => storage }));

vi.mock('./initial-sync.ts', async (importOriginal) => ({
	...(await importOriginal<typeof import('./initial-sync.ts')>()),
	syncArchive: vi.fn(async () => ({ synced: 400, skipped: 0, pruned: 3 })),
}));

import { migratedDb } from '@specboard/db/test-support';
import { comparedSpecPathChanges, performIncrementalSync } from './incremental-sync.ts';
import { syncArchive, SUPERSEDED } from './initial-sync.ts';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
/** The pending lock token the API took and put in the event. */
const PENDING = new Date('2026-10-08T12:00:00.000Z');
const BASE = 'fedcba9876543210fedcba9876543210fedcba98';

let projectId: string;

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

interface CompareFile { sha: string; filename: string; status: string; previous_filename?: string }

/**
 * GitHub with the branch at HEAD, this compare from the base, and these blobs by sha
 * ("# New" otherwise). The head's tree lists every file the compare names as a 5-byte
 * blob, unless `tree` says otherwise (a size, or a submodule).
 */
function github(
	compare: { files: CompareFile[]; total_commits?: number; commits?: unknown[]; status?: string },
	blobs: Record<string, Buffer> = {},
	tree: Record<string, { size?: number; submodule?: boolean }> = {}
): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(async (url: string) => {
		if (url.includes('/git/refs/heads/')) return json({ object: { sha: HEAD } });
		if (url.includes('/compare/')) {
			return json({ status: 'ahead', ahead_by: 1, behind_by: 0, total_commits: 1, commits: [{ sha: HEAD }], ...compare });
		}
		if (url.includes('/git/trees/')) {
			return json({
				truncated: false,
				tree: compare.files.filter((f) => f.status !== 'removed').map((f) => ({
					path: f.filename,
					mode: tree[f.filename]?.submodule ? '160000' : '100644',
					type: tree[f.filename]?.submodule ? 'commit' : 'blob',
					sha: f.sha,
					...(tree[f.filename]?.submodule ? {} : { size: tree[f.filename]?.size ?? blobs[f.sha]?.length ?? 5 }),
				})),
			});
		}
		const sha = url.split('/git/blobs/')[1]!;
		if (sha === 'missing') return new Response('{}', { status: 404 });
		const blob = blobs[sha] ?? Buffer.from('# New');
		return json({ content: blob.toString('base64'), encoding: 'base64', sha, size: blob.length });
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

async function project(): Promise<{ last_synced_commit_sha: string; sync_status: string; sync_error: string | null }> {
	const result = await state.db!.query<{ last_synced_commit_sha: string; sync_status: string; sync_error: string | null }>(
		'SELECT last_synced_commit_sha, sync_status, sync_error FROM projects WHERE id = $1', [projectId]
	);
	return result.rows[0]!;
}

async function links(): Promise<string[]> {
	const result = await state.db!.query<{ path: string }>('SELECT path FROM epic_specs WHERE project_id = $1 ORDER BY path', [projectId]);
	return result.rows.map((r) => r.path);
}

function sync(lastCommitSha = BASE, lockToken = PENDING): ReturnType<typeof performIncrementalSync> {
	return performIncrementalSync(
		{ projectId, owner: 'acme', repo: 'docs', branch: 'main', token: 'token', lastCommitSha, lockToken },
		'http://storage',
		'key'
	);
}

beforeAll(async () => {
	const db = await migratedDb();
	state.db = db;
	vi.stubEnv('DATABASE_URL', 'postgres://pglite/test');
	const user = await db.query<{ id: string }>("INSERT INTO users (username, slug, email) VALUES ('acme', 'acme', 'acme@example.com') RETURNING id");
	const created = await db.query<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key, storage_mode) VALUES ('Docs', $1, 'docs', 'DOC', 'cloud') RETURNING id",
		[user.rows[0]!.id]
	);
	projectId = created.rows[0]!.id;
	await db.query(
		"INSERT INTO items (project_id, type, title, status, sub_status, number) VALUES ($1, 'task', 'item', 'ready', 'not_started', 1)",
		[projectId]
	);
}, 60_000);

beforeEach(async () => {
	vi.clearAllMocks();
	storage.putFile.mockImplementation(async () => {});
	const db = state.db!;
	// The API took the lock as 'pending' before invoking the sync.
	await db.query(
		"UPDATE projects SET last_synced_commit_sha = $2, sync_status = 'pending', sync_started_at = $3, sync_error = NULL WHERE id = $1",
		[projectId, BASE, PENDING]
	);
	await db.query('DELETE FROM epic_specs');
	await db.query(
		`INSERT INTO epic_specs (item_id, project_id, path, spec_type)
		 SELECT id, project_id, p, 'product' FROM items, unnest(ARRAY['/docs/old.md', '/docs/gone.md', '/docs/kept.md']) AS p
		 WHERE project_id = $1`,
		[projectId]
	);
});

afterAll(async () => {
	vi.unstubAllGlobals();
	await state.db?.close();
});

describe('comparedSpecPathChanges', () => {
	it('takes renames and removals from the compare, whatever the file sync skips', () => {
		expect(comparedSpecPathChanges([
			{ sha: '1', filename: 'docs/new.md', status: 'renamed', previous_filename: 'docs/old.md' },
			{ sha: '2', filename: 'node_modules/x/README.md', status: 'removed' },
			{ sha: '3', filename: 'docs/edited.md', status: 'modified' },
			{ sha: '4', filename: 'docs/added.md', status: 'added' },
		])).toEqual({
			renamed: [{ from: '/docs/old.md', to: '/docs/new.md' }],
			deleted: ['/node_modules/x/README.md'],
		});
	});
});

describe('performIncrementalSync', () => {
	it('moves spec links for what the pulled commits renamed and removed, and stores the full head SHA', async () => {
		github({
			files: [
				{ sha: 'b1', filename: 'docs/new.md', status: 'renamed', previous_filename: 'docs/old.md' },
				{ sha: 'b2', filename: 'docs/gone.md', status: 'removed' },
			],
		});

		expect(await sync()).toMatchObject({ success: true, commitSha: HEAD });

		expect(await links()).toEqual(['/docs/kept.md', '/docs/new.md']);
		expect(await project()).toMatchObject({ last_synced_commit_sha: HEAD, sync_status: 'completed' });
		expect((await project()).last_synced_commit_sha).toMatch(/^[0-9a-f]{40}$/);
	});

	it('replaces a short sync point with the full SHA even when nothing changed', async () => {
		await state.db!.query("UPDATE projects SET last_synced_commit_sha = '0123456' WHERE id = $1", [projectId]);
		github({ files: [], total_commits: 0, commits: [] });

		expect(await sync('0123456')).toMatchObject({ success: true, commitSha: HEAD });

		expect((await project()).last_synced_commit_sha).toBe(HEAD);
	});

	it.each([
		['300 files', { files: Array.from({ length: 300 }, (_, i) => ({ sha: `s${i}`, filename: `docs/${i}.md`, status: 'modified' })) }],
		['more commits than it lists', { files: [{ sha: 's', filename: 'docs/old.md', status: 'removed' }], total_commits: 251, commits: Array.from({ length: 250 }, () => ({ sha: 'x' })) }],
	])('falls back to a full sync of the head when the compare is cut off (%s)', async (_what, compare) => {
		github(compare);

		expect(await sync()).toMatchObject({ success: true, commitSha: HEAD, synced: 400, removed: 3 });

		expect(vi.mocked(syncArchive).mock.calls[0]![2]).toBe(HEAD);
		expect(await links()).toEqual(['/docs/gone.md', '/docs/kept.md', '/docs/old.md']);
		expect((await project()).last_synced_commit_sha).toBe(HEAD);
	});

	it('falls back to a full sync when the branch was rewritten (the compare diverged)', async () => {
		github({ status: 'diverged', files: [{ sha: 'b2', filename: 'docs/gone.md', status: 'removed' }] });

		expect(await sync()).toMatchObject({ success: true, commitSha: HEAD });

		expect(vi.mocked(syncArchive)).toHaveBeenCalled();
		expect(await links()).toEqual(['/docs/gone.md', '/docs/kept.md', '/docs/old.md']);
	});

	it('does nothing when its pending lock isn\'t the one waiting (a late or repeated invocation)', async () => {
		github({ files: [{ sha: 'b2', filename: 'docs/gone.md', status: 'removed' }] });

		expect(await sync(BASE, new Date('2026-10-08T11:00:00.000Z'))).toMatchObject({ success: false, error: SUPERSEDED });

		expect(await project()).toMatchObject({ last_synced_commit_sha: BASE, sync_status: 'pending' });
	});

	it('changes nothing when a commit moved the sync point after the sync was started', async () => {
		github({ files: [{ sha: 'b2', filename: 'docs/gone.md', status: 'removed' }] });
		const committed = 'c'.repeat(40);
		await state.db!.query('UPDATE projects SET last_synced_commit_sha = $2 WHERE id = $1', [projectId, committed]);

		expect(await sync()).toMatchObject({ success: false, error: SUPERSEDED });

		expect(await links()).toEqual(['/docs/gone.md', '/docs/kept.md', '/docs/old.md']);
		expect(await project()).toMatchObject({ last_synced_commit_sha: committed, sync_status: 'failed' });
	});

	it('does nothing when the lock is held by someone else', async () => {
		await state.db!.query("UPDATE projects SET sync_status = 'committing' WHERE id = $1", [projectId]);
		github({ files: [{ sha: 'b2', filename: 'docs/gone.md', status: 'removed' }] });

		expect(await sync()).toMatchObject({ success: false, error: SUPERSEDED });

		expect(await project()).toMatchObject({ last_synced_commit_sha: BASE, sync_status: 'committing' });
		expect(await links()).toEqual(['/docs/gone.md', '/docs/kept.md', '/docs/old.md']);
	});

	it('fails without moving the sync point or links when a file couldn\'t be written', async () => {
		github({
			files: [
				{ sha: 'b1', filename: 'docs/new.md', status: 'renamed', previous_filename: 'docs/old.md' },
				{ sha: 'b2', filename: 'docs/edited.md', status: 'modified' },
			],
		});
		storage.putFile.mockImplementation(async (_p: string, path: string) => {
			if (path === 'docs/edited.md') throw new Error('500: storage unavailable');
		});

		const result = await sync();

		expect(result).toMatchObject({ success: false });
		expect(result.error).toContain('docs/edited.md');
		expect(await project()).toMatchObject({ last_synced_commit_sha: BASE, sync_status: 'failed' });
		expect(await links()).toEqual(['/docs/gone.md', '/docs/kept.md', '/docs/old.md']);
	});

	it('records a file a push made too large from its listed size, without downloading it', async () => {
		const fetchMock = github({ files: [{ sha: 'b'.repeat(40), filename: 'docs/kept.md', status: 'modified' }] }, {}, { 'docs/kept.md': { size: 600_000 } });

		expect(await sync()).toMatchObject({ success: true, unavailable: 1, synced: 0 });

		expect(storage.markUnavailable).toHaveBeenCalledWith(projectId, 'docs/kept.md', 'too_large', 'b'.repeat(40), 600_000);
		expect(storage.putFile).not.toHaveBeenCalled();
		expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/git/blobs/'))).toBe(false);
		expect((await project()).last_synced_commit_sha).toBe(HEAD);
	});

	it('skips a submodule bump instead of failing on its "blob"', async () => {
		const fetchMock = github(
			{ files: [{ sha: 'c'.repeat(40), filename: 'vendored', status: 'modified' }, { sha: 'b2', filename: 'docs/gone.md', status: 'removed' }] },
			{},
			{ vendored: { submodule: true } }
		);

		expect(await sync()).toMatchObject({ success: true, commitSha: HEAD });

		expect(storage.deleteFile).toHaveBeenCalledWith(projectId, 'vendored');
		expect(storage.putFile).not.toHaveBeenCalled();
		expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/git/blobs/'))).toBe(false);
	});

	it('fails on a blob that\'s genuinely missing', async () => {
		github({ files: [{ sha: 'missing', filename: 'docs/kept.md', status: 'modified' }] });

		const result = await sync();

		expect(result).toMatchObject({ success: false });
		expect(result.error).toContain('docs/kept.md');
		expect((await project()).last_synced_commit_sha).toBe(BASE);
	});

	it('records a file a push made binary', async () => {
		const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3]);
		github({ files: [{ sha: 'bin', filename: 'docs/kept.md', status: 'modified' }] }, { bin: binary });

		expect(await sync()).toMatchObject({ success: true, unavailable: 1 });

		expect(storage.markUnavailable).toHaveBeenCalledWith(projectId, 'docs/kept.md', 'binary', 'bin', binary.length);
	});

	it('removes the old path of a file renamed into a skipped directory', async () => {
		github({ files: [{ sha: 'b1', filename: 'node_modules/old.md', status: 'renamed', previous_filename: 'docs/old.md' }] });

		expect(await sync()).toMatchObject({ success: true, removed: 1, synced: 0 });

		expect(storage.deleteFile).toHaveBeenCalledWith(projectId, 'docs/old.md');
		expect(storage.putFile).not.toHaveBeenCalled();
	});
});

