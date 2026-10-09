/**
 * A file on the branch the editor can't hold (binary, or over the sync's size limit):
 * recorded with the new version's hash and no content, its older content gone, served
 * as unavailable, and back to an ordinary file when a later sync stores it again. Real
 * Postgres (PGlite, this service's migrations); S3 in memory.
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
	getFileContent: async (projectId: string, path: string) => state.s3.get(`${projectId}/files/${path}`) ?? null,
	putFileContent: async (projectId: string, path: string, content: string) => {
		state.s3.set(`${projectId}/files/${path}`, content);
	},
	deleteFileContent: async (projectId: string, path: string) => {
		state.s3.delete(`${projectId}/files/${path}`);
	},
}));

import { filesRoutes } from './files.ts';

const PROJECT = '00000000-0000-0000-0000-000000000001';
const HASH = 'f'.repeat(40);

function call(method: string, path: string, body?: unknown): Promise<Response> {
	return Promise.resolve(filesRoutes.request(`/${PROJECT}${path}`, {
		method,
		headers: { 'Content-Type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
	state.s3.clear();
	await call('PUT', '/docs/spec.md', { content: '# Spec' });
});

afterAll(async () => {
	await state.db?.close();
});

describe('a file the editor can\'t hold', () => {
	it('keeps its row with the new hash, drops the older content, and serves no content', async () => {
		const marked = await call('POST', '/unavailable', { path: 'docs/spec.md', reason: 'too_large', contentHash: HASH, sizeBytes: 600_000 });
		expect(marked.status).toBe(200);

		expect(state.s3.has(`${PROJECT}/files/docs/spec.md`)).toBe(false);
		expect(await (await call('GET', '/docs/spec.md')).json()).toMatchObject({
			path: 'docs/spec.md',
			content: null,
			contentHash: HASH,
			sizeBytes: 600_000,
			unavailable: 'too_large',
		});
		expect(((await (await call('GET', '')).json()) as { files: unknown[] }).files).toEqual([
			expect.objectContaining({ path: 'docs/spec.md', contentHash: HASH, unavailable: 'too_large' }),
		]);
	});

	it('is an ordinary file again once a sync stores it', async () => {
		await call('POST', '/unavailable', { path: 'docs/spec.md', reason: 'binary', contentHash: HASH, sizeBytes: 10 });

		await call('PUT', '/docs/spec.md', { content: '# Spec, text again' });

		const file = await (await call('GET', '/docs/spec.md')).json();
		expect(file).toMatchObject({ content: '# Spec, text again' });
		expect(file).not.toHaveProperty('unavailable');
		expect(((await (await call('GET', '')).json()) as { files: unknown[] }).files).toEqual([
			expect.objectContaining({ path: 'docs/spec.md', unavailable: null }),
		]);
	});

	it.each([
		['an unknown reason', { path: 'docs/spec.md', reason: 'huge', contentHash: HASH, sizeBytes: 1 }],
		['a path that escapes', { path: '../spec.md', reason: 'binary', contentHash: HASH, sizeBytes: 1 }],
		['no hash', { path: 'docs/spec.md', reason: 'binary', sizeBytes: 1 }],
		['a negative size', { path: 'docs/spec.md', reason: 'binary', contentHash: HASH, sizeBytes: -1 }],
	])('refuses %s', async (_what, body) => {
		expect((await call('POST', '/unavailable', body)).status).toBe(400);
		expect(await (await call('GET', '/docs/spec.md')).json()).toMatchObject({ content: '# Spec' });
	});
});

describe('paths with characters URLs treat specially', () => {
	it.each(['docs/C#.md', 'docs/what?.md', 'docs/100%.md', 'docs/two words.md', 'docs/ünïcødé.md'])(
		'stores and reads %s under its own name',
		async (path) => {
			const urlPath = path.split('/').map(encodeURIComponent).join('/');

			expect((await call('PUT', `/${urlPath}`, { content: '# Odd' })).status).toBe(200);

			expect(await (await call('GET', `/${urlPath}`)).json()).toMatchObject({ path, content: '# Odd' });
			expect(state.s3.get(`${PROJECT}/files/${path}`)).toBe('# Odd');
			expect((await call('DELETE', `/${urlPath}`)).status).toBe(200);
			expect((await call('GET', `/${urlPath}`)).status).toBe(404);
		}
	);
});

