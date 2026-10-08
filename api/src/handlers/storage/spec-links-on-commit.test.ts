/**
 * Committing a cloud project's drafts (docs/specs/project-storage.md, Committing).
 *
 * Spec links follow a file's rename or delete when that change is committed, not when
 * it is drafted: a draft is one user's, every other member still has the file, so its
 * links stay put until the commit lands. A local project writes straight to disk, so
 * its links follow at once. A commit GitHub accepts becomes the committed files every
 * member reads; one GitHub refuses because the branch moved changes nothing.
 *
 * The real handlers and CloudStorageProvider run against migrated Postgres (PGlite) for
 * the links and an in-memory storage service for files and pending changes; only the
 * GitHub commit itself is stubbed.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import type { PGlite } from '@electric-sql/pglite';
import type { ProjectAccess, ResolvedProject } from '@specboard/db';

type Action = 'modified' | 'created' | 'deleted';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

/**
 * The storage service's contract, in memory: committed files shared by everyone, and
 * pending changes per user. A write that names no rename origin keeps the one the
 * change already has; a deletion has none (storage/src/db/queries.ts). Promoting a
 * commit writes its files and clears the pending changes it took, unless one was saved
 * again since (its updatedAt moved); `failPromote` makes it fail before changing
 * anything, as a rolled-back transaction does. A draft's base is what was committed at
 * its path when its row was first written (here the content itself stands in for the
 * hash), and a draft conflicts when what's committed there now differs.
 */
const storage = vi.hoisted(() => {
	// Committed files' hashes are sha1 of their content, as the storage service's are.
	const { createHash } = process.getBuiltinModule('node:crypto');
	const hashOf = (content: string | undefined): string | null =>
		content === undefined ? null : createHash('sha1').update(content).digest('hex');
	interface Pending { content: string | null; action: Action; renamedFrom: string | null; updatedAt: string; base: string | null }
	const committed = new Map<string, string>();
	// Committed files a sync found binary or too large: a row with no content.
	const unavailable = new Set<string>();
	const pending = new Map<string, Map<string, Pending>>();
	let clock = 0;
	const flags = { failPromote: false };
	const mine = (userId: string): Map<string, Pending> => {
		let changes = pending.get(userId);
		if (!changes) {
			changes = new Map();
			pending.set(userId, changes);
		}
		return changes;
	};
	// A draft holding exactly what's committed now would commit as a no-op: not a conflict.
	const list = (userId: string): Array<Pending & { path: string; conflict: boolean }> =>
		[...mine(userId)].map(([path, change]) => {
			const now = hashOf(committed.get(path));
			const noOp = change.action !== 'deleted' && change.content === (committed.get(path) ?? null);
			return {
				path,
				...change,
				conflict: change.base !== now && !noOp,
				baseContentHash: change.base,
				contentHash: change.content === null ? null : hashOf(change.content),
				committedHash: now,
			};
		});
	const client = {
		listFiles: async () => [...committed.keys()].map((path) => ({
			path, contentHash: 'h', sizeBytes: 1, syncedAt: 'then', unavailable: unavailable.has(path) ? 'binary' : null,
		})),
		getFile: async (_projectId: string, path: string) => {
			const content = committed.get(path);
			if (content === undefined) return null;
			return unavailable.has(path)
				? { path, content: null, contentHash: 'b'.repeat(40), unavailable: 'binary' }
				: { path, content, contentHash: hashOf(content) };
		},
		listPendingChanges: async (_projectId: string, userId: string) => list(userId),
		listPendingChangesWithContent: async (_projectId: string, userId: string) => list(userId),
		getPendingChange: async (_projectId: string, userId: string, path: string) => {
			const change = mine(userId).get(path);
			return change ? { path, ...change, baseContentHash: change.base } : null;
		},
		putPendingChange: async (
			_projectId: string, userId: string, path: string, content: string | null, action: Action,
			renamedFrom: string | null, baseContentHash: string | null | undefined
		) => {
			const existing = mine(userId).get(path);
			const kept = renamedFrom ?? existing?.renamedFrom ?? null;
			const updatedAt = new Date(Date.UTC(2026, 0, 1) + ++clock).toISOString();
			const base = existing ? existing.base : baseContentHash !== undefined ? baseContentHash : hashOf(committed.get(path));
			mine(userId).set(path, { content, action, renamedFrom: action === 'deleted' ? null : kept, updatedAt, base });
			return { path, action, isLarge: false };
		},
		deletePendingChange: async (_projectId: string, userId: string, path: string) => {
			mine(userId).delete(path);
		},
		promoteCommit: async (_projectId: string, userId: string, changes: Array<{ path: string; action: Action; content: string | null; updatedAt: string }>) => {
			if (flags.failPromote) throw new Error('Storage service error: transaction rolled back');
			for (const change of changes) {
				if (change.action === 'deleted') committed.delete(change.path);
				else committed.set(change.path, change.content!);
				const draft = mine(userId).get(change.path);
				if (draft?.updatedAt === change.updatedAt) mine(userId).delete(change.path);
				else if (draft) draft.base = hashOf(committed.get(change.path));
			}
		},
		undoRename: vi.fn(async (_projectId: string, userId: string, oldPath: string, newPath: string) => {
			mine(userId).delete(oldPath);
			mine(userId).delete(newPath);
		}),
		rebasePendingChanges: async (_projectId: string, userId: string, paths: string[]) => {
			const rebased: string[] = [];
			const dropped: string[] = [];
			for (const path of paths) {
				const draft = mine(userId).get(path);
				if (!draft) continue;
				const now = hashOf(committed.get(path));
				if (draft.action === 'deleted' && now === null) {
					mine(userId).delete(path);
					dropped.push(path);
					continue;
				}
				draft.base = now;
				if (draft.action !== 'deleted') draft.action = now === null ? 'created' : 'modified';
				rebased.push(path);
			}
			return { rebased, dropped };
		},
	};
	return { committed, unavailable, pending, mine, client, flags, hashOf };
});

/** A local project's checkout, in memory. */
const disk = vi.hoisted(() => ({ files: new Set<string>() }));

vi.mock('pg', async () => (await import('@specboard/db/test-support')).pgliteAsPg(() => state.db!));

vi.mock('../../services/storage/storage-client.ts', () => ({
	getStorageClient: () => storage.client,
}));

vi.mock('../../services/storage/local-provider.ts', () => ({
	LocalStorageProvider: class {
		async exists(path: string): Promise<boolean> {
			return disk.files.has(path);
		}
		async rename(from: string, to: string): Promise<void> {
			disk.files.delete(from);
			disk.files.add(to);
		}
		async deleteFile(path: string): Promise<void> {
			disk.files.delete(path);
		}
	},
}));

vi.mock('../../services/github-commit.ts', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../services/github-commit.ts')>()),
	createGitHubCommit: vi.fn(),
}));

vi.mock('@specboard/auth', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/auth')>()),
	decrypt: vi.fn(() => 'github-token'),
}));

import { migratedDb } from '@specboard/db/test-support';
import { applySpecPathChanges } from '@specboard/db';
import { comparedSpecPathChanges } from '@specboard/sync-lambda';
import { createGitHubCommit, STALE_BRANCH_MESSAGE } from '../../services/github-commit.ts';
import { handleCreateFile, handleDeleteFile, handleReadFile, handleRenameFile, handleWriteFile } from './file-handlers.ts';
import { handleCommit, handleGetGitStatus, handleKeepMine, handleReadCommittedFile, handleRestore, handleUndoRename } from './git-handlers.ts';
import { handleListSpecs } from '../specs.ts';
import type { AppVariables } from '../../project-access.ts';

const redis = {} as Redis;

/** The sync point the drafts were made against, and the commit GitHub answers with. */
const BASE = 'fedcba9876543210fedcba9876543210fedcba98';
const COMMIT_SHA = 'c0ffee0000000000000000000000000000000000';

let alice: string;
let erin: string;
const projects = new Map<string, ResolvedProject>();
let cloudItemId: string;
let localItemId: string;

async function insertUser(db: PGlite, slug: string): Promise<string> {
	const result = await db.query<{ id: string }>(
		'INSERT INTO users (username, slug, email) VALUES ($1, $1, $2) RETURNING id',
		[slug, `${slug}@example.com`]
	);
	return result.rows[0]!.id;
}

async function insertProject(db: PGlite, slug: string, key: string, mode: 'cloud' | 'local', repository: object): Promise<ResolvedProject> {
	const result = await db.query<{ id: string }>(
		`INSERT INTO projects (name, owner_id, slug, key, storage_mode, repository, root_paths, last_synced_commit_sha)
		 VALUES ($1, $2, $1, $3, $4, $5, '["/"]', $6) RETURNING id`,
		[slug, alice, key, mode, JSON.stringify(repository), BASE]
	);
	return { id: result.rows[0]!.id, slug, key, ownerSlug: 'acme' };
}

async function insertItem(db: PGlite, projectId: string): Promise<string> {
	const result = await db.query<{ id: string }>(
		"INSERT INTO items (project_id, type, title, status, sub_status, number) VALUES ($1, 'task', 'Spec me', 'ready', 'not_started', 1) RETURNING id",
		[projectId]
	);
	return result.rows[0]!.id;
}

function createApp(): Hono<{ Variables: AppVariables }> {
	const app = new Hono<{ Variables: AppVariables }>();
	app.use('/api/projects/:owner/:project/*', async (context, next) => {
		const project = projects.get(context.req.param('project'))!;
		const userId = context.req.header('x-user') === 'erin' ? erin : alice;
		const role = userId === alice ? 'owner' : 'editor';
		const access: ProjectAccess = { project, grantedRole: role, effectiveRole: role };
		context.set('access', access);
		context.set('project', project);
		context.set('userId', userId);
		await next();
	});
	app.get('/api/projects/:owner/:project/files', handleReadFile);
	app.post('/api/projects/:owner/:project/files', (context) => handleCreateFile(context, redis));
	app.put('/api/projects/:owner/:project/files', (context) => handleWriteFile(context, redis));
	app.get('/api/projects/:owner/:project/git/status', handleGetGitStatus);
	app.put('/api/projects/:owner/:project/files/rename', (context) => handleRenameFile(context, redis));
	app.delete('/api/projects/:owner/:project/files', (context) => handleDeleteFile(context, redis));
	app.post('/api/projects/:owner/:project/git/restore', (context) => handleRestore(context, redis));
	app.post('/api/projects/:owner/:project/git/keep-mine', (context) => handleKeepMine(context, redis));
	app.post('/api/projects/:owner/:project/git/undo-rename', (context) => handleUndoRename(context, redis));
	app.get('/api/projects/:owner/:project/git/committed', handleReadCommittedFile);
	app.post('/api/projects/:owner/:project/git/commit', handleCommit);
	app.get('/api/projects/:owner/:project/items/:itemKey/specs', handleListSpecs);
	return app;
}

async function call(as: 'alice' | 'erin', method: string, path: string, body?: unknown, project = 'docs'): Promise<Response> {
	return createApp().request(`http://localhost/api/projects/acme/${project}/${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', 'x-user': as },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

/** The spec paths a member sees on the item. */
async function specPaths(as: 'alice' | 'erin', project = 'docs'): Promise<string[]> {
	const key = project === 'docs' ? 'DOC-1' : 'LOC-1';
	const response = await call(as, 'GET', `items/${key}/specs`, undefined, project);
	expect(response.status).toBe(200);
	return ((await response.json()) as Array<{ path: string }>).map((s) => s.path).sort();
}

/** The item's spec links as "path type", for checks where which link went where matters. */
async function specLinks(): Promise<string[]> {
	const response = await call('alice', 'GET', 'items/DOC-1/specs');
	return ((await response.json()) as Array<{ path: string; type: string }>).map((s) => `${s.path} ${s.type}`).sort();
}

/** An edit and a delete, for tests that only need some draft to commit. */
async function draftAnEditAndADelete(): Promise<void> {
	await call('alice', 'PUT', 'files?path=/docs/spec.md', { content: '# Spec, edited' });
	await deleteFile('/docs/other.md');
}

async function syncedSha(): Promise<string | null> {
	const result = await state.db!.query<{ last_synced_commit_sha: string | null }>(
		'SELECT last_synced_commit_sha FROM projects WHERE id = $1', [projects.get('docs')!.id]
	);
	return result.rows[0]!.last_synced_commit_sha;
}

const deleteFileAs = (as: 'alice' | 'erin', path: string): Promise<Response> =>
	call(as, 'DELETE', `files?path=${encodeURIComponent(path)}`);
const deleteFile = (path: string, project = 'docs'): Promise<Response> =>
	call('alice', 'DELETE', `files?path=${encodeURIComponent(path)}`, undefined, project);
const renameFile = (oldPath: string, newPath: string, project = 'docs'): Promise<Response> =>
	call('alice', 'PUT', 'files/rename', { oldPath, newPath }, project);
const commit = (as: 'alice' | 'erin' = 'alice'): Promise<Response> => call(as, 'POST', 'git/commit', {});

beforeAll(async () => {
	const db = await migratedDb();
	state.db = db;
	vi.stubEnv('DATABASE_URL', 'postgres://pglite/test');
	alice = await insertUser(db, 'acme');
	erin = await insertUser(db, 'erin');
	await db.query(
		"INSERT INTO github_connections (user_id, github_user_id, github_username, access_token, scopes) VALUES ($1, 'acme-gh', 'acme-gh', '{}', '{repo}')",
		[alice]
	);
	await db.query(
		"INSERT INTO github_connections (user_id, github_user_id, github_username, access_token, scopes) VALUES ($1, 'erin-gh', 'erin-gh', '{}', '{repo}')",
		[erin]
	);

	const cloud = await insertProject(db, 'docs', 'DOC', 'cloud', {
		type: 'cloud',
		remote: { provider: 'github', owner: 'acme', repo: 'docs', url: 'https://github.com/acme/docs' },
		branch: 'main',
	});
	const local = await insertProject(db, 'local', 'LOC', 'local', { type: 'local', localPath: '/repo', branch: 'main' });
	projects.set('docs', cloud);
	projects.set('local', local);
	await db.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'editor')", [cloud.id, erin]);
	cloudItemId = await insertItem(db, cloud.id);
	localItemId = await insertItem(db, local.id);
}, 60_000);

beforeEach(async () => {
	vi.mocked(createGitHubCommit).mockReset();
	vi.mocked(createGitHubCommit).mockResolvedValue({ success: true, sha: COMMIT_SHA, url: 'https://github.com/acme/docs/commit/c0ffee0', filesCommitted: 1 });

	storage.committed.clear();
	storage.unavailable.clear();
	storage.pending.clear();
	storage.flags.failPromote = false;
	storage.committed.set('docs/spec.md', '# Spec');
	storage.committed.set('docs/other.md', '# Other');
	disk.files = new Set(['/docs/spec.md', '/docs/other.md']);

	const db = state.db!;
	await db.query('UPDATE projects SET last_synced_commit_sha = $1, sync_status = NULL, sync_started_at = NULL', [BASE]);
	await db.query('DELETE FROM epic_specs');
	for (const [itemId, projectId] of [[cloudItemId, projects.get('docs')!.id], [localItemId, projects.get('local')!.id]]) {
		await db.query(
			"INSERT INTO epic_specs (item_id, project_id, path, spec_type) VALUES ($1, $2, '/docs/spec.md', 'product'), ($1, $2, '/docs/other.md', 'technical')",
			[itemId, projectId]
		);
	}
});

afterAll(async () => {
	await state.db?.close();
});

describe('a cloud draft leaves spec links alone', () => {
	it('keeps them through a draft delete, and the restore leaves nothing to undo', async () => {
		expect((await deleteFile('/docs/spec.md')).status).toBe(200);

		expect(await specPaths('alice')).toEqual(['/docs/other.md', '/docs/spec.md']);

		expect((await call('alice', 'POST', 'git/restore', { path: '/docs/spec.md' })).status).toBe(200);
		expect(storage.mine(alice).size).toBe(0);
		expect(await specPaths('alice')).toEqual(['/docs/other.md', '/docs/spec.md']);
	});

	it('shows another member the file and its links unchanged until the commit', async () => {
		await deleteFile('/docs/spec.md');
		await renameFile('/docs/other.md', '/docs/renamed.md');

		expect((await call('erin', 'GET', 'files?path=/docs/spec.md')).status).toBe(200);
		expect((await call('erin', 'GET', 'files?path=/docs/other.md')).status).toBe(200);
		expect(await specPaths('erin')).toEqual(['/docs/other.md', '/docs/spec.md']);

		expect((await commit()).status).toBe(200);

		expect(await specPaths('erin')).toEqual(['/docs/renamed.md']);
	});
});

describe('committing a cloud draft', () => {
	it('drops the links of a file it deletes', async () => {
		await deleteFile('/docs/spec.md');

		const response = await commit();

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ success: true, sha: COMMIT_SHA });
		expect(await specPaths('alice')).toEqual(['/docs/other.md']);
	});

	it('moves the links of a file it renames', async () => {
		expect((await renameFile('/docs/spec.md', '/guides/spec.md')).status).toBe(200);
		expect(await specPaths('alice')).toEqual(['/docs/other.md', '/docs/spec.md']);

		await commit();

		expect(await specPaths('alice')).toEqual(['/docs/other.md', '/guides/spec.md']);
	});

	it('moves them to where a file renamed twice and edited in between ended up', async () => {
		await renameFile('/docs/spec.md', '/docs/draft.md');
		expect((await call('alice', 'PUT', 'files?path=/docs/draft.md', { content: '# Edited' })).status).toBe(200);
		await renameFile('/docs/draft.md', '/docs/final.md');

		expect(storage.mine(alice).get('docs/final.md')).toMatchObject({ action: 'created', renamedFrom: 'docs/spec.md' });

		await commit();

		expect(await specPaths('alice')).toEqual(['/docs/final.md', '/docs/other.md']);
	});

	it('leaves the links where they are when the old path was restored before the commit', async () => {
		await renameFile('/docs/spec.md', '/docs/copy.md');
		await call('alice', 'POST', 'git/restore', { path: '/docs/spec.md' });

		await commit();

		expect(await specPaths('alice')).toEqual(['/docs/other.md', '/docs/spec.md']);
	});

	it('changes no links when GitHub refuses the commit', async () => {
		vi.mocked(createGitHubCommit).mockResolvedValue({
			success: false,
			error: STALE_BRANCH_MESSAGE,
			conflictDetected: true,
		});
		await deleteFile('/docs/other.md');
		await renameFile('/docs/spec.md', '/docs/moved.md');

		const response = await commit();

		expect(response.status).toBe(409);
		expect(await specPaths('alice')).toEqual(['/docs/other.md', '/docs/spec.md']);
		expect(storage.mine(alice).size).toBe(3);
	});
});

describe('committing renames that reuse a path', () => {
	// beforeEach links /docs/spec.md as product and /docs/other.md as technical.

	it('archives a file and promotes another into its place', async () => {
		await renameFile('/docs/spec.md', '/docs/archive.md');
		await renameFile('/docs/other.md', '/docs/spec.md');

		await commit();

		expect(await specLinks()).toEqual(['/docs/archive.md product', '/docs/spec.md technical']);
	});

	it('drops a deleted file\'s links when another file is renamed onto its path', async () => {
		await deleteFile('/docs/other.md');
		await renameFile('/docs/spec.md', '/docs/other.md');

		await commit();

		expect(await specLinks()).toEqual(['/docs/other.md product']);
	});

	it('swaps two files through a temporary name', async () => {
		await renameFile('/docs/spec.md', '/docs/tmp.md');
		await renameFile('/docs/other.md', '/docs/spec.md');
		await renameFile('/docs/tmp.md', '/docs/other.md');

		await commit();

		expect(await specLinks()).toEqual(['/docs/other.md product', '/docs/spec.md technical']);
	});

	it('moves a chain of renames together', async () => {
		await renameFile('/docs/other.md', '/docs/third.md');
		await renameFile('/docs/spec.md', '/docs/other.md');

		await commit();

		expect(await specLinks()).toEqual(['/docs/other.md product', '/docs/third.md technical']);
	});
});

describe('when the links can\'t be recorded after GitHub took the commit', () => {
	async function refuseLinkWrites(when: 'always' | 'once'): Promise<void> {
		await state.db!.exec(`
			CREATE SEQUENCE IF NOT EXISTS link_write_attempts;
			ALTER SEQUENCE link_write_attempts RESTART;
			CREATE OR REPLACE FUNCTION refuse_link_writes() RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN
				-- A sequence isn't rolled back with the transaction, so it counts attempts.
				IF '${when}' = 'always' OR nextval('link_write_attempts') = 1 THEN
					RAISE EXCEPTION 'links unavailable';
				END IF;
				RETURN NULL;
			END $$;
			CREATE TRIGGER refuse_link_writes BEFORE UPDATE OR DELETE ON epic_specs
				FOR EACH STATEMENT EXECUTE FUNCTION refuse_link_writes();
		`);
	}

	async function allowLinkWrites(): Promise<void> {
		await state.db!.exec('DROP TRIGGER refuse_link_writes ON epic_specs;');
	}

	it('retries, so a passing failure still lands the links and the sync point', async () => {
		await refuseLinkWrites('once');
		try {
			await renameFile('/docs/spec.md', '/docs/moved.md');
			await deleteFile('/docs/other.md');

			const response = await commit();

			expect(await response.json()).toEqual(expect.not.objectContaining({ warning: expect.anything() }));
		} finally {
			await allowLinkWrites();
		}

		expect(await specPaths('alice')).toEqual(['/docs/moved.md']);
		expect(await syncedSha()).toBe(COMMIT_SHA);
	});

	it('leaves links and sync point together when it keeps failing; the pull that recovers can drop links', async () => {
		await refuseLinkWrites('always');
		try {
			await renameFile('/docs/spec.md', '/docs/moved.md');
			await call('alice', 'PUT', 'files?path=/docs/moved.md', { content: '# Rewritten from scratch' });
			await deleteFile('/docs/other.md');

			const response = await commit();

			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ success: true, sha: COMMIT_SHA, warning: expect.stringContaining('Pull') });
		} finally {
			await allowLinkWrites();
		}

		// The files were promoted; links and sync point were not, together.
		expect([...storage.committed.keys()].sort()).toEqual(['docs/moved.md']);
		expect(await specPaths('alice')).toEqual(['/docs/other.md', '/docs/spec.md']);
		expect(await syncedSha()).toBe(BASE);

		// The next pull reads GitHub's compare for the same commit. GitHub reports a
		// rename whose content changed this much as a removal and an addition, so the
		// renamed file's links are dropped rather than moved.
		const projectId = projects.get('docs')!.id;
		await applySpecPathChanges(projectId, comparedSpecPathChanges([
			{ sha: 'b1', filename: 'docs/moved.md', status: 'added' },
			{ sha: 'b2', filename: 'docs/spec.md', status: 'removed' },
			{ sha: 'b3', filename: 'docs/other.md', status: 'removed' },
		]));

		expect(await specPaths('alice')).toEqual([]);
	});
});

describe('the sync lock', () => {
	async function lockState(): Promise<{ sync_status: string | null }> {
		const result = await state.db!.query<{ sync_status: string | null }>('SELECT sync_status FROM projects WHERE id = $1', [projects.get('docs')!.id]);
		return result.rows[0]!;
	}

	it('refuses a commit while a sync holds it, and changes nothing', async () => {
		await state.db!.query("UPDATE projects SET sync_status = 'syncing', sync_started_at = NOW() WHERE id = $1", [projects.get('docs')!.id]);
		await draftAnEditAndADelete();

		const response = await commit();

		expect(response.status).toBe(409);
		expect(createGitHubCommit).not.toHaveBeenCalled();
		expect(storage.mine(alice).size).toBe(2);
		expect(await lockState()).toEqual({ sync_status: 'syncing' });
	});

	it('takes over a lock its holder left for longer than any sync runs, and records that sync as failed', async () => {
		await state.db!.query("UPDATE projects SET sync_status = 'syncing', sync_started_at = NOW() - interval '1 hour' WHERE id = $1", [projects.get('docs')!.id]);
		await draftAnEditAndADelete();

		expect((await commit()).status).toBe(200);
		expect(await syncedSha()).toBe(COMMIT_SHA);
		const after = await state.db!.query<{ sync_status: string; sync_error: string | null }>(
			'SELECT sync_status, sync_error FROM projects WHERE id = $1', [projects.get('docs')!.id]
		);
		expect(after.rows[0]).toEqual({ sync_status: 'failed', sync_error: 'The last sync didn\'t finish. Pull again.' });
	});

	it('is held while the commit runs and put back as it was afterwards', async () => {
		await state.db!.query("UPDATE projects SET sync_status = 'completed' WHERE id = $1", [projects.get('docs')!.id]);
		let during: { sync_status: string | null } | undefined;
		vi.mocked(createGitHubCommit).mockImplementation(async () => {
			during = await lockState();
			return { success: false, error: 'GitHub API error: 502 Bad Gateway' };
		});
		await draftAnEditAndADelete();

		expect((await commit()).status).toBe(500);

		expect(during).toEqual({ sync_status: 'committing' });
		expect(await lockState()).toEqual({ sync_status: 'completed' });
	});

	it('refuses a pull while a commit holds it', async () => {
		const { trySetSyncPending } = await import('../github-sync.ts');
		await state.db!.query("UPDATE projects SET sync_status = 'committing', sync_started_at = NOW() WHERE id = $1", [projects.get('docs')!.id]);

		expect(await trySetSyncPending(projects.get('docs')!.id)).toBeNull();
		expect(await lockState()).toEqual({ sync_status: 'committing' });
	});
});

describe('a sync point stored as an abbreviated SHA', () => {
	it('answers 409 to pull first instead of sending it to GitHub', async () => {
		await state.db!.query("UPDATE projects SET last_synced_commit_sha = 'fedcba9' WHERE id = $1", [projects.get('docs')!.id]);
		await draftAnEditAndADelete();

		const response = await commit();

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ conflictDetected: true, error: { message: expect.stringContaining('Pull first') } });
		expect(createGitHubCommit).not.toHaveBeenCalled();
		expect(storage.mine(alice).size).toBe(2);
	});
});

describe('after a commit', () => {
	async function draftEverything(): Promise<void> {
		expect((await call('alice', 'PUT', 'files?path=/docs/spec.md', { content: '# Spec, edited' })).status).toBe(200);
		expect((await call('alice', 'POST', 'files?path=/docs/new.md')).status).toBe(200);
		expect((await call('alice', 'PUT', 'files?path=/docs/new.md', { content: '# New' })).status).toBe(200);
		expect((await deleteFile('/docs/other.md')).status).toBe(200);
		expect((await renameFile('/docs/spec.md', '/guides/spec.md')).status).toBe(200);
	}

	async function read(as: 'alice' | 'erin', path: string): Promise<string | number> {
		const response = await call(as, 'GET', `files?path=${encodeURIComponent(path)}`);
		return response.status === 200 ? ((await response.json()) as { content: string }).content : response.status;
	}

	it('shows the committer the committed files, with no drafts left', async () => {
		await draftEverything();

		const response = await commit();
		expect(response.status).toBe(200);
		// The drafts it took, so an editor holding one open takes the new base.
		expect(((await response.json()) as { paths: string[] }).paths.sort()).toEqual(
			['/docs/new.md', '/docs/other.md', '/docs/spec.md', '/guides/spec.md']
		);

		expect(storage.mine(alice).size).toBe(0);
		expect(await read('alice', '/guides/spec.md')).toBe('# Spec, edited');
		expect(await read('alice', '/docs/new.md')).toBe('# New');
		expect(await read('alice', '/docs/other.md')).toBe(404);
		expect(await read('alice', '/docs/spec.md')).toBe(404);
		const status = await call('alice', 'GET', 'git/status');
		expect(((await status.json()) as { changedFiles: unknown[] }).changedFiles).toEqual([]);
		expect(await syncedSha()).toBe(COMMIT_SHA);
	});

	it('shows another member the commit, which they didn\'t see while it was a draft', async () => {
		await draftEverything();
		expect(await read('erin', '/docs/spec.md')).toBe('# Spec');
		expect(await read('erin', '/docs/new.md')).toBe(404);

		await commit();

		expect(await read('erin', '/guides/spec.md')).toBe('# Spec, edited');
		expect(await read('erin', '/docs/new.md')).toBe('# New');
		expect(await read('erin', '/docs/other.md')).toBe(404);
		expect(await read('erin', '/docs/spec.md')).toBe(404);
	});

	it('keeps a draft saved while the commit was in flight', async () => {
		await call('alice', 'PUT', 'files?path=/docs/spec.md', { content: '# Committed' });
		vi.mocked(createGitHubCommit).mockImplementation(async () => {
			await storage.client.putPendingChange('', alice, 'docs/spec.md', '# Saved during the commit', 'modified', null, undefined);
			return { success: true, sha: COMMIT_SHA, url: 'https://github.com/acme/docs/commit/c0ffee0', filesCommitted: 1 };
		});

		await commit();

		expect(storage.committed.get('docs/spec.md')).toBe('# Committed');
		expect(await read('alice', '/docs/spec.md')).toBe('# Saved during the commit');
	});
});

describe('a commit GitHub refuses because the branch moved', () => {
	it('answers 409 with the reason, commits against the last sync, and changes nothing', async () => {
		vi.mocked(createGitHubCommit).mockResolvedValue({ success: false, error: STALE_BRANCH_MESSAGE, conflictDetected: true });
		await draftAnEditAndADelete();

		const response = await commit();

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			success: false,
			conflictDetected: true,
			error: { stage: 'commit', message: STALE_BRANCH_MESSAGE },
		});
		expect(vi.mocked(createGitHubCommit).mock.calls[0]![0]).toMatchObject({ expectedHeadOid: BASE });
		expect(storage.mine(alice).size).toBe(2);
		expect([...storage.committed.entries()].sort()).toEqual([['docs/other.md', '# Other'], ['docs/spec.md', '# Spec']]);
		expect(await specPaths('alice')).toEqual(['/docs/other.md', '/docs/spec.md']);
		expect(await syncedSha()).toBe(BASE);
	});
});

describe('when storage can\'t take the commit after GitHub did', () => {
	it('answers success with a warning and changes nothing here, so a pull brings it in', async () => {
		storage.flags.failPromote = true;
		await draftAnEditAndADelete();

		const response = await commit();

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ success: true, sha: COMMIT_SHA, warning: expect.stringContaining('Pull') });
		expect(storage.mine(alice).size).toBe(2);
		expect([...storage.committed.entries()].sort()).toEqual([['docs/other.md', '# Other'], ['docs/spec.md', '# Spec']]);
		expect(await specPaths('alice')).toEqual(['/docs/other.md', '/docs/spec.md']);
		expect(await syncedSha()).toBe(BASE);
	});
});

describe('a local project', () => {
	it('moves links on the rename itself', async () => {
		expect((await renameFile('/docs/spec.md', '/docs/moved.md', 'local')).status).toBe(200);

		expect(await specPaths('alice', 'local')).toEqual(['/docs/moved.md', '/docs/other.md']);
	});

	it('drops links on the delete itself', async () => {
		expect((await deleteFile('/docs/other.md', 'local')).status).toBe(200);

		expect(await specPaths('alice', 'local')).toEqual(['/docs/spec.md']);
	});
});

describe('a draft someone else\'s commit changed under', () => {
	const save = (as: 'alice' | 'erin', path: string, content: string): Promise<Response> =>
		call(as, 'PUT', `files?path=${encodeURIComponent(path)}`, { content });

	it('refuses the second member\'s commit with the conflicting files, and writes nothing', async () => {
		await save('erin', '/docs/spec.md', '# Spec, Erin\'s take');
		await save('alice', '/docs/spec.md', '# Spec, Alice\'s take');
		expect((await commit('alice')).status).toBe(200);
		vi.mocked(createGitHubCommit).mockClear();

		const response = await commit('erin');

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			success: false,
			reason: 'draft_conflicts',
			conflicts: [{ path: '/docs/spec.md', action: 'modified' }],
			error: { stage: 'commit' },
		});
		expect(createGitHubCommit).not.toHaveBeenCalled();
		expect(storage.committed.get('docs/spec.md')).toBe('# Spec, Alice\'s take');
		expect(storage.mine(erin).get('docs/spec.md')).toMatchObject({ content: '# Spec, Erin\'s take' });
		expect(await syncedSha()).toBe(COMMIT_SHA);
		const lock = await state.db!.query<{ sync_status: string | null }>('SELECT sync_status FROM projects WHERE id = $1', [projects.get('docs')!.id]);
		expect(lock.rows[0]!.sync_status).not.toBe('committing');
	});

	it('commits the draft as it is after "keep mine"', async () => {
		await save('erin', '/docs/spec.md', '# Spec, Erin\'s take');
		await save('alice', '/docs/spec.md', '# Spec, Alice\'s take');
		await commit('alice');
		const after = 'd'.repeat(40);
		vi.mocked(createGitHubCommit).mockResolvedValue({ success: true, sha: after, url: 'u', filesCommitted: 1 });

		const kept = await call('erin', 'POST', 'git/keep-mine', { paths: ['/docs/spec.md'] });
		expect(await kept.json()).toEqual({ rebased: ['/docs/spec.md'], dropped: [] });

		expect((await commit('erin')).status).toBe(200);
		expect(vi.mocked(createGitHubCommit).mock.calls.at(-1)![0].changes).toEqual([
			{ path: 'docs/spec.md', content: '# Spec, Erin\'s take', action: 'modified' },
		]);
		expect(storage.committed.get('docs/spec.md')).toBe('# Spec, Erin\'s take');
	});

	it('leaves nothing to commit after discarding the draft', async () => {
		await save('erin', '/docs/spec.md', '# Spec, Erin\'s take');
		await save('alice', '/docs/spec.md', '# Spec, Alice\'s take');
		await commit('alice');

		expect((await call('erin', 'POST', 'git/restore', { path: '/docs/spec.md' })).status).toBe(200);

		expect(storage.mine(erin).size).toBe(0);
		expect((await call('erin', 'GET', 'files?path=/docs/spec.md')).status).toBe(200);
		expect(((await (await call('erin', 'GET', 'files?path=/docs/spec.md')).json()) as { content: string }).content).toBe('# Spec, Alice\'s take');
	});

	it('counts a created file when someone committed one at the same path', async () => {
		await call('erin', 'POST', 'files?path=/docs/new.md');
		await call('alice', 'POST', 'files?path=/docs/new.md');
		await save('alice', '/docs/new.md', '# Alice\'s new page');
		await commit('alice');

		const response = await commit('erin');

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ conflicts: [{ path: '/docs/new.md', action: 'created' }] });
	});

	it('counts a deletion of a file someone changed, and "keep mine" still deletes it', async () => {
		await deleteFileAs('erin', '/docs/other.md');
		await save('alice', '/docs/other.md', '# Other, revised');
		await commit('alice');

		const refused = await commit('erin');
		expect(refused.status).toBe(409);
		expect(await refused.json()).toMatchObject({ conflicts: [{ path: '/docs/other.md', action: 'deleted' }] });

		await call('erin', 'POST', 'git/keep-mine', { paths: ['/docs/other.md'] });
		expect((await commit('erin')).status).toBe(200);
		expect(storage.committed.has('docs/other.md')).toBe(false);
	});

	it('flags a rename whose source someone changed, through the source path', async () => {
		await call('erin', 'PUT', 'files/rename', { oldPath: '/docs/spec.md', newPath: '/docs/moved.md' });
		await save('alice', '/docs/spec.md', '# Spec, Alice\'s take');
		await commit('alice');

		const response = await commit('erin');

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ conflicts: [{ path: '/docs/spec.md', action: 'deleted' }] });
	});

	it('shows the conflict in git status once a pull brings the change in', async () => {
		await save('erin', '/docs/spec.md', '# Spec, Erin\'s take');
		// What a pull's sync does: rewrite the committed file, leave drafts alone.
		storage.committed.set('docs/spec.md', '# Spec, pushed from outside');

		const status = await call('erin', 'GET', 'git/status');

		expect(((await status.json()) as { changedFiles: unknown[] }).changedFiles).toEqual([
			{ path: '/docs/spec.md', status: 'modified', isUntracked: false, conflict: true },
		]);
	});

	it('serves the committed version beside the draft for comparing', async () => {
		await save('erin', '/docs/spec.md', '# Spec, Erin\'s take');

		const committed = await call('erin', 'GET', 'git/committed?path=/docs/spec.md');
		const gone = await call('erin', 'GET', 'git/committed?path=/docs/never.md');

		expect(await committed.json()).toEqual({ path: '/docs/spec.md', content: '# Spec' });
		expect(await gone.json()).toEqual({ path: '/docs/never.md', content: null });
	});

	it('catches a draft whose first save comes after someone else\'s commit to the file it loaded', async () => {
		// Erin opens spec.md, then Alice commits a change to it.
		const opened = (await (await call('erin', 'GET', 'files?path=/docs/spec.md')).json()) as { content: string; baseContentHash: string };
		expect(opened.baseContentHash).toBe(storage.hashOf('# Spec'));
		await save('alice', '/docs/spec.md', '# Spec, Alice\'s take');
		await commit('alice');

		// Erin's first save arrives only now, carrying what she loaded.
		await call('erin', 'PUT', 'files?path=/docs/spec.md', { content: '# Spec, Erin\'s take', baseContentHash: opened.baseContentHash });
		const response = await commit('erin');

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ conflicts: [{ path: '/docs/spec.md' }] });
		expect(storage.committed.get('docs/spec.md')).toBe('# Spec, Alice\'s take');
	});

	it('gives the open document its draft\'s base, not what\'s committed now', async () => {
		await save('erin', '/docs/spec.md', '# Spec, Erin\'s take');
		await save('alice', '/docs/spec.md', '# Spec, Alice\'s take');
		await commit('alice');

		const reopened = (await (await call('erin', 'GET', 'files?path=/docs/spec.md')).json()) as { baseContentHash: string };

		expect(reopened.baseContentHash).toBe(storage.hashOf('# Spec'));
	});

	it('doesn\'t count a draft that holds exactly what\'s committed now', async () => {
		await save('erin', '/docs/spec.md', '# Same words');
		await save('alice', '/docs/spec.md', '# Same words');
		await commit('alice');

		const status = await call('erin', 'GET', 'git/status');

		expect(((await status.json()) as { changedFiles: Array<{ conflict: boolean }> }).changedFiles[0]!.conflict).toBe(false);
	});

	it('refuses to read a committed file outside the project\'s roots', async () => {
		const projectId = projects.get('docs')!.id;
		await state.db!.query(`UPDATE projects SET root_paths = '["/docs"]' WHERE id = $1`, [projectId]);
		try {
			const response = await call('erin', 'GET', 'git/committed?path=/secrets/env.md');

			expect(response.status).toBe(403);
			expect(await response.json()).toMatchObject({ code: 'PATH_OUTSIDE_ROOTS' });
		} finally {
			await state.db!.query(`UPDATE projects SET root_paths = '["/"]' WHERE id = $1`, [projectId]);
		}
	});

	it('catches a rename of a file someone changed after it was opened, as a rename', async () => {
		// Erin opens spec.md, Alice commits a change to it, then Erin renames it from the header.
		const opened = (await (await call('erin', 'GET', 'files?path=/docs/spec.md')).json()) as { baseContentHash: string };
		await save('alice', '/docs/spec.md', '# Spec, Alice\'s take');
		await commit('alice');

		await call('erin', 'PUT', 'files/rename', { oldPath: '/docs/spec.md', newPath: '/docs/renamed.md', baseContentHash: opened.baseContentHash });
		const response = await commit('erin');

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ conflicts: [{ path: '/docs/spec.md', action: 'deleted' }] });
		const status = (await (await call('erin', 'GET', 'git/status')).json()) as { changedFiles: Array<{ path: string; renamedTo?: string; conflict: boolean }> };
		expect(status.changedFiles.find((f) => f.path === '/docs/spec.md')).toMatchObject({ conflict: true, renamedTo: '/docs/renamed.md' });
		expect(storage.committed.get('docs/spec.md')).toBe('# Spec, Alice\'s take');
	});

	it('catches a delete of a file someone changed after it was seen', async () => {
		const opened = (await (await call('erin', 'GET', 'files?path=/docs/spec.md')).json()) as { baseContentHash: string };
		await save('alice', '/docs/spec.md', '# Spec, Alice\'s take');
		await commit('alice');

		await call('erin', 'DELETE', `files?path=/docs/spec.md&baseContentHash=${opened.baseContentHash}`);

		expect((await commit('erin')).status).toBe(409);
	});

	it('refuses a base that isn\'t a content hash', async () => {
		const response = await call('erin', 'PUT', 'files?path=/docs/spec.md', { content: '# x', baseContentHash: 'not-a-hash' });

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: 'INVALID_BASE' });
	});

	it('undoes a rename in one call', async () => {
		await call('erin', 'PUT', 'files/rename', { oldPath: '/docs/spec.md', newPath: '/docs/renamed.md' });
		expect(storage.mine(erin).size).toBe(2);

		const response = await call('erin', 'POST', 'git/undo-rename', { oldPath: '/docs/spec.md', newPath: '/docs/renamed.md' });

		expect(response.status).toBe(200);
		expect(storage.client.undoRename).toHaveBeenCalledTimes(1);
		expect(storage.mine(erin).size).toBe(0);
	});

	it('says a created file is one the caller created, even after a later save', async () => {
		await call('erin', 'POST', 'files?path=/docs/new.md');
		await call('alice', 'POST', 'files?path=/docs/new.md');
		await call('alice', 'PUT', 'files?path=/docs/new.md', { content: '# Alice\'s new page' });
		await commit('alice');
		await call('erin', 'PUT', 'files?path=/docs/new.md', { content: '# Erin\'s new page' });

		const status = (await (await call('erin', 'GET', 'git/status')).json()) as { changedFiles: Array<{ path: string; status: string; conflict: boolean }> };

		expect(status.changedFiles).toEqual([expect.objectContaining({ path: '/docs/new.md', status: 'added', conflict: true })]);
	});

	it('says when a rename carries the other person\'s latest version', async () => {
		const opened = (await (await call('erin', 'GET', 'files?path=/docs/spec.md')).json()) as { baseContentHash: string };
		await save('alice', '/docs/spec.md', '# Spec, Alice\'s take');
		await commit('alice');

		// No edits: the server copies what's committed now to the new name.
		await call('erin', 'PUT', 'files/rename', { oldPath: '/docs/spec.md', newPath: '/docs/d2.md', baseContentHash: opened.baseContentHash });
		const status = (await (await call('erin', 'GET', 'git/status')).json()) as { changedFiles: Array<{ path: string; renameKeepsCommitted?: boolean }> };

		expect(status.changedFiles.find((f) => f.path === '/docs/spec.md')).toMatchObject({ renamedTo: '/docs/d2.md', renameKeepsCommitted: true, conflict: true });
	});
});

describe('a file a sync found binary or too large', () => {
	it('can\'t be opened or saved, and says why', async () => {
		storage.unavailable.add('docs/spec.md');

		const read = await call('erin', 'GET', 'files?path=/docs/spec.md');
		const write = await call('erin', 'PUT', 'files?path=/docs/spec.md', { content: '# Mine' });

		expect(read.status).toBe(409);
		expect(await read.json()).toMatchObject({ code: 'FILE_UNAVAILABLE', error: expect.stringContaining('500 KB') });
		expect(write.status).toBe(409);
		expect(storage.mine(erin).size).toBe(0);
	});

	it('refuses a commit with a draft made before the file became one, and writes nothing', async () => {
		await call('alice', 'PUT', 'files?path=/docs/spec.md', { content: '# Spec, mine' });
		// A pull brings in a push that made spec.md binary.
		storage.unavailable.add('docs/spec.md');

		const response = await commit();

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			reason: 'unavailable_files',
			files: [{ path: '/docs/spec.md' }],
			error: { stage: 'commit', message: expect.stringContaining('/docs/spec.md') },
		});
		expect(createGitHubCommit).not.toHaveBeenCalled();
		expect(storage.mine(alice).size).toBe(1);
	});

	it('can still be deleted', async () => {
		storage.unavailable.add('docs/other.md');

		expect((await deleteFile('/docs/other.md')).status).toBe(200);
		expect((await commit()).status).toBe(200);
		expect(storage.committed.has('docs/other.md')).toBe(false);
	});
});

