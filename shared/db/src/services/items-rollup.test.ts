/**
 * The status rollup run against real Postgres (PGlite) with every migration applied:
 * how far the walk goes, whose updated_at a child write moves, and which Ready it may
 * promote. The mocked suite in
 * items.test.ts pins statement shapes; this one pins what the statements do.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import type { PGlite, Transaction } from '@electric-sql/pglite';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

vi.mock('../index.ts', () => ({
	query: (text: string, params?: unknown[]) => state.db!.query(text, params),
	transaction: <T>(fn: (client: Transaction) => Promise<T>) => state.db!.transaction(fn),
}));

import { applyMigration, migratedDb } from '../test-support/migrated-db.ts';
import { createItem, createItems, deleteItem, moveItem, startItem, blockItem, unblockItem, updateItem } from './items.ts';

const ORIGIN = { actor: { type: 'user' as const, userId: '00000000-0000-0000-0000-000000000000' } };
const LONG_AGO = '2000-01-01T00:00:00Z';

let projectId: string;

async function sql<T>(text: string, params: unknown[] = []): Promise<T[]> {
	return (await state.db!.query<T>(text, params)).rows;
}

async function insertItem(number: number, parent: number | null, status: string, source: string): Promise<void> {
	await sql(
		`INSERT INTO items (project_id, parent_id, type, title, status, sub_status, status_source, number, updated_at)
		 VALUES ($1, (SELECT id FROM items WHERE project_id = $1 AND number = $2), 'task', $3, $4, 'not_started', $5, $6, $7)`,
		[projectId, parent, `item ${number}`, status, source, number, LONG_AGO]
	);
}

async function item(number: number): Promise<{ status: string; status_source: string; touched: boolean }> {
	const [row] = await sql<{ status: string; status_source: string; touched: boolean }>(
		'SELECT status, status_source, updated_at > $3 AS touched FROM items WHERE project_id = $1 AND number = $2',
		[projectId, number, LONG_AGO]
	);
	return row!;
}

beforeAll(async () => {
	state.db = await migratedDb();
	const [user] = await sql<{ id: string }>("INSERT INTO users (email) VALUES ('rollup@example.com') RETURNING id");
	const [project] = await sql<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key, item_seq) VALUES ('Rollup', $1, 'rollup', 'RU', 100) RETURNING id",
		[user!.id]
	);
	projectId = project!.id;
}, 60_000);

beforeEach(async () => {
	await sql('DELETE FROM items WHERE project_id = $1', [projectId]);
});

afterAll(async () => {
	await state.db?.close();
});

describe('the walk', () => {
	it('keeps climbing past a level that holds still: an explicit in_progress parent under a ready grandparent', async () => {
		await insertItem(1, null, 'ready', 'default');
		await insertItem(2, 1, 'in_progress', 'explicit');
		await insertItem(3, 2, 'ready', 'explicit');

		await startItem(projectId, 3);

		expect(await item(2)).toMatchObject({ status: 'in_progress', status_source: 'explicit' });
		expect(await item(1)).toMatchObject({ status: 'in_progress', status_source: 'rollup' });
	});

	it('rolls a grandparent back through a parent that stays put', async () => {
		await insertItem(1, null, 'in_progress', 'rollup');
		await insertItem(2, 1, 'ready', 'rollup');
		await insertItem(3, 2, 'in_progress', 'explicit');

		await updateItem(projectId, 3, { status: 'ready' });

		expect((await item(2)).status).toBe('ready');
		expect(await item(1)).toMatchObject({ status: 'ready', status_source: 'rollup' });
	});
});

describe('updated_at on a child write', () => {
	beforeEach(async () => {
		await insertItem(1, null, 'in_progress', 'explicit');
		await insertItem(2, 1, 'ready', 'default');
		await insertItem(3, 2, 'ready', 'explicit');
	});

	it('creating a child touches its parent, leaves its status and source alone, and not the grandparent', async () => {
		await createItem(projectId, { title: 'new', type: 'task', parentNumber: 2, origin: ORIGIN });

		expect(await item(2)).toEqual({ status: 'ready', status_source: 'default', touched: true });
		expect((await item(1)).touched).toBe(false);
	});

	it('a bulk create touches its parent', async () => {
		await createItems(projectId, 2, [{ title: 'a' }, { title: 'b' }], ORIGIN);

		expect(await item(2)).toEqual({ status: 'ready', status_source: 'default', touched: true });
		expect((await item(1)).touched).toBe(false);
	});

	it("a child's status change touches its parent even when the parent's status holds", async () => {
		await blockItem(projectId, 3);

		expect(await item(2)).toEqual({ status: 'ready', status_source: 'default', touched: true });
		expect((await item(1)).touched).toBe(false);
	});

	it('a parent the rollup moves touches its own parent in turn', async () => {
		await startItem(projectId, 3);

		expect(await item(2)).toEqual({ status: 'in_progress', status_source: 'rollup', touched: true });
		expect(await item(1)).toEqual({ status: 'in_progress', status_source: 'explicit', touched: true });
	});

	it('an edit that restates the current status does not touch the parent', async () => {
		await updateItem(projectId, 3, { title: 'renamed', status: 'ready', subStatus: 'not_started' });

		expect((await item(3)).touched).toBe(true);
		expect((await item(2)).touched).toBe(false);
	});

	it('an edit that moves the status does touch the parent', async () => {
		await updateItem(projectId, 3, { status: 'blocked' });

		expect((await item(2)).touched).toBe(true);
		expect((await item(1)).touched).toBe(false);
	});

	it('deleting a child touches the parent it left', async () => {
		await deleteItem(projectId, 3);

		expect((await item(2)).touched).toBe(true);
		expect((await item(1)).touched).toBe(false);
	});

	it('moving a child touches the parent it left and the one it joined', async () => {
		await insertItem(4, 1, 'ready', 'explicit');

		await moveItem(projectId, 3, 4);

		expect((await item(2)).touched).toBe(true);
		expect((await item(4)).touched).toBe(true);
		expect((await item(1)).touched).toBe(false);
	});
});

describe('which Ready the rollup promotes', () => {
	async function epicWithChild(): Promise<{ epic: number; child: number }> {
		const epic = await createItem(projectId, { title: 'epic', origin: ORIGIN });
		const child = await createItem(projectId, { title: 'task', type: 'task', parentNumber: epic.number, origin: ORIGIN });
		return { epic: epic.number, child: child.number };
	}

	it('a freshly created epic promotes when a child starts', async () => {
		const { epic, child } = await epicWithChild();
		expect(await item(epic)).toMatchObject({ status: 'ready', status_source: 'default' });

		await startItem(projectId, child);

		expect(await item(epic)).toMatchObject({ status: 'in_progress', status_source: 'rollup' });
	});

	it('an epic dragged to Ready stays there when a child starts', async () => {
		const { epic, child } = await epicWithChild();
		await updateItem(projectId, epic, { status: 'in_progress' });
		await updateItem(projectId, epic, { status: 'ready', subStatus: 'not_started' });
		expect(await item(epic)).toMatchObject({ status: 'ready', status_source: 'explicit' });

		await startItem(projectId, child);

		expect(await item(epic)).toMatchObject({ status: 'ready', status_source: 'explicit' });
	});

	it('a create that names Ready is explicit and stays; one that names nothing promotes', async () => {
		const named = await createItem(projectId, { title: 'named', status: 'ready', origin: ORIGIN });
		const child = await createItem(projectId, { title: 'task', type: 'task', parentNumber: named.number, status: 'in_progress', origin: ORIGIN });
		expect(await item(named.number)).toMatchObject({ status: 'ready', status_source: 'explicit' });
		expect((await item(child.number)).status).toBe('in_progress');
	});

	it('an epic returned to Ready by unblock still promotes', async () => {
		const { epic, child } = await epicWithChild();
		await blockItem(projectId, epic);
		await unblockItem(projectId, epic);
		expect(await item(epic)).toMatchObject({ status: 'ready', status_source: 'default' });

		await startItem(projectId, child);

		expect(await item(epic)).toMatchObject({ status: 'in_progress', status_source: 'rollup' });
	});

	it('an unblock of an item that was not blocked is a deliberate Ready, as MCP routes a bare status=ready', async () => {
		const { epic, child } = await epicWithChild();
		await updateItem(projectId, epic, { status: 'in_progress' });
		await unblockItem(projectId, epic);
		expect(await item(epic)).toMatchObject({ status: 'ready', status_source: 'explicit' });

		await startItem(projectId, child);

		expect((await item(epic)).status).toBe('ready');
	});

	it('a Ready the rollup rolled back is promotable again', async () => {
		const { epic, child } = await epicWithChild();
		await startItem(projectId, child);
		await updateItem(projectId, child, { status: 'ready' });
		expect(await item(epic)).toMatchObject({ status: 'ready', status_source: 'rollup' });

		await startItem(projectId, child);

		expect((await item(epic)).status).toBe('in_progress');
	});

	it('restating Ready on an edit keeps a default Ready promotable', async () => {
		const { epic, child } = await epicWithChild();
		await updateItem(projectId, epic, { title: 'renamed', status: 'ready', subStatus: 'not_started' });
		expect((await item(epic)).status_source).toBe('default');

		await startItem(projectId, child);

		expect((await item(epic)).status).toBe('in_progress');
	});
});

describe('the 032 backfill', () => {
	it('leaves existing ready rows promotable and keeps existing in_progress rows explicit', async () => {
		const main = state.db;
		const db = await migratedDb('032_item_status_source.sql');
		try {
			const [user] = (await db.query<{ id: string }>("INSERT INTO users (email) VALUES ('backfill@example.com') RETURNING id")).rows;
			const [project] = (await db.query<{ id: string }>(
				"INSERT INTO projects (name, owner_id, slug, key, item_seq) VALUES ('Backfill', $1, 'backfill', 'BF', 10) RETURNING id",
				[user!.id]
			)).rows;
			const insert = (number: number, parent: number | null, status: string): Promise<unknown> => db.query(
				`INSERT INTO items (project_id, parent_id, type, title, status, sub_status, number)
				 VALUES ($1, (SELECT id FROM items WHERE project_id = $1 AND number = $2), 'task', 't', $3, 'not_started', $4)`,
				[project!.id, parent, status, number]
			);
			await insert(1, null, 'ready');
			await insert(2, 1, 'ready');
			await insert(3, null, 'in_progress');
			await insert(4, null, 'blocked');
			await insert(5, null, 'done');

			await applyMigration(db, '032_item_status_source.sql');

			const sources = (await db.query<{ number: number; status_source: string }>(
				'SELECT number, status_source FROM items ORDER BY number'
			)).rows.map((r) => [r.number, r.status_source]);
			expect(sources).toEqual([[1, 'default'], [2, 'default'], [3, 'explicit'], [4, 'default'], [5, 'default']]);

			state.db = db;
			const previousProject = projectId;
			projectId = project!.id;
			try {
				await startItem(projectId, 2);
				expect(await item(1)).toMatchObject({ status: 'in_progress', status_source: 'rollup' });
			} finally {
				projectId = previousProject;
			}
		} finally {
			state.db = main;
			await db.close();
		}
	}, 60_000);
});
