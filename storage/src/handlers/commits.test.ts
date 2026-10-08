/**
 * POST /commits/:projectId/:userId against real Postgres (PGlite, this service's
 * migrations) with S3 in memory: the commit's files become the committed files, the
 * committer's pending changes it took are cleared and any saved since are kept, and a
 * failure in the transaction leaves rows and pending changes as they were.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { PGlite, type Transaction } from '@electric-sql/pglite';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined, s3: new Map<string, string>() }));

vi.mock('../db/index.ts', () => ({
	pool: { instance: { query: (text: string, params?: unknown[]) => state.db!.query(text, params) } },
	transaction: <T>(fn: (client: Transaction) => Promise<T>) => state.db!.transaction(fn),
}));

vi.mock('../services/s3.ts', () => ({
	fileKey: (projectId: string, path: string) => `${projectId}/files/${path}`,
	putFileContent: async (projectId: string, path: string, content: string) => {
		state.s3.set(`${projectId}/files/${path}`, content);
	},
	deleteFileContent: async (projectId: string, path: string) => {
		state.s3.delete(`${projectId}/files/${path}`);
	},
	deletePendingContent: async (projectId: string, userId: string, path: string) => {
		state.s3.delete(`${projectId}/pending/${userId}/${path}`);
	},
}));

import { commitRoutes } from './commits.ts';
import { upsertPendingChange, upsertProjectDocument, listPendingChanges } from '../db/queries.ts';

const PROJECT = '00000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-000000000002';

async function documents(): Promise<Array<{ path: string; content_hash: string }>> {
	return (await state.db!.query<{ path: string; content_hash: string }>(
		'SELECT path, content_hash FROM project_documents WHERE project_id = $1 ORDER BY path', [PROJECT]
	)).rows;
}

async function pendingPaths(): Promise<string[]> {
	return (await listPendingChanges(PROJECT, USER)).map((c) => c.path);
}

async function updatedAt(path: string): Promise<string> {
	return (await listPendingChanges(PROJECT, USER)).find((c) => c.path === path)!.updatedAt.toISOString();
}

function promote(body: unknown): Promise<Response> {
	return Promise.resolve(commitRoutes.request(`/${PROJECT}/${USER}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	}));
}

beforeAll(async () => {
	const db = new PGlite();
	const dir = join(import.meta.dirname, '../db/migrations');
	for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
		await db.exec(readFileSync(join(dir, file), 'utf-8'));
	}
	state.db = db;
}, 60_000);

beforeEach(async () => {
	await state.db!.query('DELETE FROM project_documents');
	await state.db!.query('DELETE FROM pending_changes');
	state.s3.clear();
	for (const [path, content] of [['docs/spec.md', '# Spec'], ['docs/old.md', '# Old']] as const) {
		state.s3.set(`${PROJECT}/files/${path}`, content);
		await upsertProjectDocument(PROJECT, path, `${PROJECT}/files/${path}`, `hash-of-${path}`, content.length);
	}
	await upsertPendingChange(PROJECT, USER, 'docs/spec.md', '# Spec, edited', null, 'modified', null);
	await upsertPendingChange(PROJECT, USER, 'docs/old.md', null, null, 'deleted', null);
	await upsertPendingChange(PROJECT, USER, 'docs/new.md', '# New', null, 'created', 'docs/old.md');
});

afterAll(async () => {
	await state.db?.close();
});

async function theCommit(): Promise<Array<{ path: string; action: string; content: string | null; updatedAt: string }>> {
	return [
		{ path: 'docs/spec.md', action: 'modified', content: '# Spec, edited', updatedAt: await updatedAt('docs/spec.md') },
		{ path: 'docs/old.md', action: 'deleted', content: null, updatedAt: await updatedAt('docs/old.md') },
		{ path: 'docs/new.md', action: 'created', content: '# New', updatedAt: await updatedAt('docs/new.md') },
	];
}

describe('POST /commits/:projectId/:userId', () => {
	it('makes the commit the committed files and clears the pending changes it took', async () => {
		const response = await promote({ changes: await theCommit() });

		expect(response.status).toBe(200);
		expect((await documents()).map((d) => d.path)).toEqual(['docs/new.md', 'docs/spec.md']);
		expect((await documents()).find((d) => d.path === 'docs/spec.md')!.content_hash).not.toBe('hash-of-docs/spec.md');
		expect(state.s3.get(`${PROJECT}/files/docs/spec.md`)).toBe('# Spec, edited');
		expect(state.s3.get(`${PROJECT}/files/docs/new.md`)).toBe('# New');
		expect(state.s3.has(`${PROJECT}/files/docs/old.md`)).toBe(false);
		expect(await pendingPaths()).toEqual([]);
	});

	it('keeps a pending change saved again after the commit read it', async () => {
		const changes = await theCommit();
		await new Promise((resolve) => setTimeout(resolve, 5));
		await upsertPendingChange(PROJECT, USER, 'docs/spec.md', '# Saved during the commit', null, 'modified', null);

		await promote({ changes });

		expect(state.s3.get(`${PROJECT}/files/docs/spec.md`)).toBe('# Spec, edited');
		expect(await pendingPaths()).toEqual(['docs/spec.md']);
	});

	it('leaves rows and pending changes as they were when the transaction fails', async () => {
		const changes = await theCommit();
		await state.db!.exec(`
			CREATE FUNCTION refuse_pending_deletes() RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN RAISE EXCEPTION 'pending changes unavailable'; END $$;
			CREATE TRIGGER refuse_pending_deletes BEFORE DELETE ON pending_changes
				FOR EACH STATEMENT EXECUTE FUNCTION refuse_pending_deletes();
		`);
		try {
			expect((await promote({ changes })).status).toBe(500);
		} finally {
			await state.db!.exec('DROP TRIGGER refuse_pending_deletes ON pending_changes; DROP FUNCTION refuse_pending_deletes();');
		}

		expect(await documents()).toEqual([
			{ path: 'docs/old.md', content_hash: 'hash-of-docs/old.md' },
			{ path: 'docs/spec.md', content_hash: 'hash-of-docs/spec.md' },
		]);
		expect(await pendingPaths()).toEqual(['docs/new.md', 'docs/old.md', 'docs/spec.md']);
		// Content was written first, and is what GitHub now has; a deleted file's object stays.
		expect(state.s3.get(`${PROJECT}/files/docs/spec.md`)).toBe('# Spec, edited');
		expect(state.s3.get(`${PROJECT}/files/docs/old.md`)).toBe('# Old');
	});

	it('keeps a deleted file\'s content when its path has a live row again by cleanup time', async () => {
		// Stands in for a write that brought the path back between the transaction and
		// the S3 cleanup: the row the commit deletes comes straight back.
		await state.db!.exec(`
			CREATE FUNCTION restore_document() RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN
				INSERT INTO project_documents (project_id, path, s3_key, content_hash, size_bytes)
				VALUES (OLD.project_id, OLD.path, OLD.s3_key, 'rewritten', OLD.size_bytes);
				RETURN NULL;
			END $$;
			CREATE TRIGGER restore_document AFTER DELETE ON project_documents
				FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION restore_document();
		`);
		try {
			expect((await promote({ changes: await theCommit() })).status).toBe(200);
		} finally {
			await state.db!.exec('DROP TRIGGER restore_document ON project_documents; DROP FUNCTION restore_document();');
		}

		expect(state.s3.get(`${PROJECT}/files/docs/old.md`)).toBe('# Old');
	});

	it.each([
		['no changes', { changes: [] }],
		['a path that escapes', { changes: [{ path: '../x.md', action: 'deleted', content: null, updatedAt: '2026-01-01T00:00:00.000Z' }] }],
		['a write without content', { changes: [{ path: 'docs/a.md', action: 'created', content: null, updatedAt: '2026-01-01T00:00:00.000Z' }] }],
		['a missing updatedAt', { changes: [{ path: 'docs/a.md', action: 'deleted', content: null }] }],
		['the same path twice', { changes: [
			{ path: 'docs/a.md', action: 'deleted', content: null, updatedAt: '2026-01-01T00:00:00.000Z' },
			{ path: 'docs/a.md', action: 'deleted', content: null, updatedAt: '2026-01-01T00:00:00.000Z' },
		] }],
	])('refuses %s with 400 and changes nothing', async (_what, body) => {
		const response = await promote(body);

		expect(response.status).toBe(400);
		expect((await documents()).map((d) => d.path)).toEqual(['docs/old.md', 'docs/spec.md']);
		expect(await pendingPaths()).toHaveLength(3);
	});
});
