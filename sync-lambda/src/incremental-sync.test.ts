/**
 * Commits that arrive by incremental sync move spec links the way a commit made in the
 * editor does: a rename GitHub reports repoints the old path's links, a removal drops
 * them. Real @specboard/db against migrated Postgres (PGlite); GitHub's compare and
 * blob endpoints are stubbed, and so is the storage service.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

vi.mock('pg', async () => (await import('@specboard/db/test-support')).pgliteAsPg(() => state.db!));

vi.mock('./shared/storage-client.ts', () => ({
	createStorageClient: () => ({ putFile: vi.fn(async () => {}), deleteFile: vi.fn(async () => {}) }),
}));

import { migratedDb } from '@specboard/db/test-support';
import { performIncrementalSync, specPathChangesOf } from './incremental-sync.ts';

let projectId: string;

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeAll(async () => {
	const db = await migratedDb();
	state.db = db;
	vi.stubEnv('DATABASE_URL', 'postgres://pglite/test');
	const user = await db.query<{ id: string }>("INSERT INTO users (username, slug, email) VALUES ('acme', 'acme', 'acme@example.com') RETURNING id");
	const project = await db.query<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key, storage_mode, last_synced_commit_sha) VALUES ('Docs', $1, 'docs', 'DOC', 'cloud', 'base') RETURNING id",
		[user.rows[0]!.id]
	);
	projectId = project.rows[0]!.id;
	const item = await db.query<{ id: string }>(
		"INSERT INTO items (project_id, type, title, status, sub_status, number) VALUES ($1, 'task', 'item', 'ready', 'not_started', 1) RETURNING id",
		[projectId]
	);
	await db.query(
		`INSERT INTO epic_specs (item_id, project_id, path, spec_type) VALUES
		 ($1, $2, '/docs/old.md', 'product'), ($1, $2, '/docs/gone.md', 'technical'), ($1, $2, '/docs/kept.md', 'technical')`,
		[item.rows[0]!.id, projectId]
	);
}, 60_000);

afterAll(async () => {
	vi.unstubAllGlobals();
	await state.db?.close();
});

describe('specPathChangesOf', () => {
	it('takes renames and removals from the compare, whatever the file sync skips', () => {
		expect(specPathChangesOf([
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
	it('moves and drops spec links for what the pulled commits renamed and removed', async () => {
		vi.stubGlobal('fetch', vi.fn(async (url: string) => {
			if (url.includes('/compare/')) {
				return json({
					status: 'ahead',
					ahead_by: 1,
					behind_by: 0,
					total_commits: 1,
					commits: [{ sha: 'head' }],
					files: [
						{ sha: 'b1', filename: 'docs/new.md', status: 'renamed', previous_filename: 'docs/old.md' },
						{ sha: 'b2', filename: 'docs/gone.md', status: 'removed' },
					],
				});
			}
			return json({ content: Buffer.from('# New').toString('base64'), encoding: 'base64', sha: 'b1', size: 5 });
		}));

		const result = await performIncrementalSync(
			{ projectId, owner: 'acme', repo: 'docs', branch: 'main', token: 'token', lastCommitSha: 'base' },
			'http://storage',
			'key'
		);

		expect(result).toMatchObject({ success: true, commitSha: 'head' });
		const links = await state.db!.query<{ path: string }>('SELECT path FROM epic_specs WHERE project_id = $1 ORDER BY path', [projectId]);
		expect(links.rows.map((r) => r.path)).toEqual(['/docs/kept.md', '/docs/new.md']);
		const project = await state.db!.query<{ last_synced_commit_sha: string }>('SELECT last_synced_commit_sha FROM projects WHERE id = $1', [projectId]);
		expect(project.rows[0]!.last_synced_commit_sha).toBe('head');
	});
});
