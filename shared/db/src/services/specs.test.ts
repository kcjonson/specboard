/**
 * applySpecPathChanges against real Postgres (PGlite): renames repoint links without
 * breaking the one-link-per-path-per-item rule, deletions drop them, other projects are
 * untouched, and a second run of the same changes (a retried sync) does nothing.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import type { PGlite, Transaction } from '@electric-sql/pglite';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

vi.mock('../index.ts', () => ({
	query: (text: string, params?: unknown[]) => state.db!.query(text, params),
	transaction: <T>(fn: (client: Transaction) => Promise<T>) => state.db!.transaction(fn),
}));

import { migratedDb } from '../test-support/migrated-db.ts';
import { applySpecPathChanges } from './specs.ts';

let projectId: string;
let otherProjectId: string;
let itemOne: string;
let itemTwo: string;

async function linksOf(project: string): Promise<string[]> {
	const result = await state.db!.query<{ number: number; path: string }>(
		`SELECT i.number, s.path FROM epic_specs s JOIN items i ON i.id = s.item_id
		 WHERE s.project_id = $1 ORDER BY i.number, s.path`,
		[project]
	);
	return result.rows.map((r) => `${r.number}:${r.path}`);
}

async function link(itemId: string, project: string, path: string): Promise<void> {
	await state.db!.query(
		"INSERT INTO epic_specs (item_id, project_id, path, spec_type) VALUES ($1, $2, $3, 'product')",
		[itemId, project, path]
	);
}

async function insertItem(project: string, number: number): Promise<string> {
	const result = await state.db!.query<{ id: string }>(
		"INSERT INTO items (project_id, type, title, status, sub_status, number) VALUES ($1, 'task', 'item', 'ready', 'not_started', $2) RETURNING id",
		[project, number]
	);
	return result.rows[0]!.id;
}

beforeAll(async () => {
	const db = await migratedDb();
	state.db = db;
	const user = await db.query<{ id: string }>("INSERT INTO users (username, slug, email) VALUES ('acme', 'acme', 'acme@example.com') RETURNING id");
	const ownerId = user.rows[0]!.id;
	const project = await db.query<{ id: string }>("INSERT INTO projects (name, owner_id, slug, key) VALUES ('Docs', $1, 'docs', 'DOC') RETURNING id", [ownerId]);
	const other = await db.query<{ id: string }>("INSERT INTO projects (name, owner_id, slug, key) VALUES ('Other', $1, 'other', 'OTH') RETURNING id", [ownerId]);
	projectId = project.rows[0]!.id;
	otherProjectId = other.rows[0]!.id;
	itemOne = await insertItem(projectId, 1);
	itemTwo = await insertItem(projectId, 2);
}, 60_000);

beforeEach(async () => {
	await state.db!.query('DELETE FROM epic_specs');
});

afterAll(async () => {
	await state.db?.close();
});

describe('applySpecPathChanges', () => {
	it('repoints renamed paths and drops deleted ones', async () => {
		await link(itemOne, projectId, '/docs/old.md');
		await link(itemTwo, projectId, '/docs/old.md');
		await link(itemTwo, projectId, '/docs/gone.md');

		await applySpecPathChanges(projectId, {
			renamed: [{ from: '/docs/old.md', to: '/docs/new.md' }],
			deleted: ['/docs/gone.md'],
		});

		expect(await linksOf(projectId)).toEqual(['1:/docs/new.md', '2:/docs/new.md']);
	});

	it('folds a renamed link into one the item already has to the new path', async () => {
		await link(itemOne, projectId, '/docs/old.md');
		await link(itemOne, projectId, '/docs/new.md');

		await applySpecPathChanges(projectId, { renamed: [{ from: '/docs/old.md', to: '/docs/new.md' }], deleted: [] });

		expect(await linksOf(projectId)).toEqual(['1:/docs/new.md']);
	});

	it('leaves another project linking the same paths alone', async () => {
		const otherItem = await insertItem(otherProjectId, 1);
		await link(otherItem, otherProjectId, '/docs/old.md');
		await link(otherItem, otherProjectId, '/docs/gone.md');

		await applySpecPathChanges(projectId, {
			renamed: [{ from: '/docs/old.md', to: '/docs/new.md' }],
			deleted: ['/docs/gone.md'],
		});

		expect(await linksOf(otherProjectId)).toEqual(['1:/docs/gone.md', '1:/docs/old.md']);
	});

	it('does nothing the second time the same changes arrive', async () => {
		await link(itemOne, projectId, '/docs/old.md');
		await link(itemTwo, projectId, '/docs/new.md');
		const changes = { renamed: [{ from: '/docs/old.md', to: '/docs/new.md' }], deleted: ['/docs/gone.md'] };

		await applySpecPathChanges(projectId, changes);
		await applySpecPathChanges(projectId, changes);

		expect(await linksOf(projectId)).toEqual(['1:/docs/new.md', '2:/docs/new.md']);
	});
});
