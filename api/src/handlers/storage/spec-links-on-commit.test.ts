/**
 * Spec links follow a file's rename or delete when that change is committed, not when it
 * is drafted (docs/specs/project-storage.md, Pending changes and spec links). On a cloud
 * project a draft is one user's: every other member still has the file, so its links
 * must stay put until the commit lands. A local project writes straight to disk, so its
 * links follow at once.
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
 * change already has; a deletion has none (storage/src/db/queries.ts).
 */
const storage = vi.hoisted(() => {
	interface Pending { content: string | null; action: Action; renamedFrom: string | null }
	const committed = new Map<string, string>();
	const pending = new Map<string, Map<string, Pending>>();
	const mine = (userId: string): Map<string, Pending> => {
		let changes = pending.get(userId);
		if (!changes) {
			changes = new Map();
			pending.set(userId, changes);
		}
		return changes;
	};
	const list = (userId: string): Array<Pending & { path: string; updatedAt: string }> =>
		[...mine(userId)].map(([path, change]) => ({ path, ...change, updatedAt: 'now' }));
	const client = {
		listFiles: async () => [...committed.keys()].map((path) => ({ path, contentHash: 'h', sizeBytes: 1, syncedAt: 'then' })),
		getFile: async (_projectId: string, path: string) => {
			const content = committed.get(path);
			return content === undefined ? null : { path, content };
		},
		listPendingChanges: async (_projectId: string, userId: string) => list(userId),
		listPendingChangesWithContent: async (_projectId: string, userId: string) => list(userId),
		getPendingChange: async (_projectId: string, userId: string, path: string) => {
			const change = mine(userId).get(path);
			return change ? { path, ...change, updatedAt: 'now' } : null;
		},
		putPendingChange: async (_projectId: string, userId: string, path: string, content: string | null, action: Action, renamedFrom: string | null) => {
			const kept = renamedFrom ?? mine(userId).get(path)?.renamedFrom ?? null;
			mine(userId).set(path, { content, action, renamedFrom: action === 'deleted' ? null : kept });
			return { path, action, isLarge: false };
		},
		deletePendingChange: async (_projectId: string, userId: string, path: string) => {
			mine(userId).delete(path);
		},
		deleteAllPendingChanges: async (_projectId: string, userId: string) => {
			const count = mine(userId).size;
			mine(userId).clear();
			return { deleted: true, count };
		},
	};
	return { committed, pending, mine, client };
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
import { createGitHubCommit } from '../../services/github-commit.ts';
import { handleDeleteFile, handleReadFile, handleRenameFile, handleWriteFile } from './file-handlers.ts';
import { handleCommit, handleRestore } from './git-handlers.ts';
import { handleListSpecs } from '../specs.ts';
import type { AppVariables } from '../../project-access.ts';

const redis = {} as Redis;

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
		`INSERT INTO projects (name, owner_id, slug, key, storage_mode, repository, root_paths)
		 VALUES ($1, $2, $1, $3, $4, $5, '["/"]') RETURNING id`,
		[slug, alice, key, mode, JSON.stringify(repository)]
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
	app.put('/api/projects/:owner/:project/files', (context) => handleWriteFile(context, redis));
	app.put('/api/projects/:owner/:project/files/rename', (context) => handleRenameFile(context, redis));
	app.delete('/api/projects/:owner/:project/files', (context) => handleDeleteFile(context, redis));
	app.post('/api/projects/:owner/:project/git/restore', (context) => handleRestore(context, redis));
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

const deleteFile = (path: string, project = 'docs'): Promise<Response> =>
	call('alice', 'DELETE', `files?path=${encodeURIComponent(path)}`, undefined, project);
const renameFile = (oldPath: string, newPath: string, project = 'docs'): Promise<Response> =>
	call('alice', 'PUT', 'files/rename', { oldPath, newPath }, project);
const commit = (): Promise<Response> => call('alice', 'POST', 'git/commit', {});

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
	vi.mocked(createGitHubCommit).mockResolvedValue({ success: true, sha: 'c0ffee', url: 'https://github.com/acme/docs/commit/c0ffee', filesCommitted: 1 });

	storage.committed.clear();
	storage.pending.clear();
	storage.committed.set('docs/spec.md', '# Spec');
	storage.committed.set('docs/other.md', '# Other');
	disk.files = new Set(['/docs/spec.md', '/docs/other.md']);

	const db = state.db!;
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
		expect(await response.json()).toMatchObject({ success: true, sha: 'c0ffee' });
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
			error: 'Remote has new changes. Sync before committing.',
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
