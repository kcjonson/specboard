/**
 * The blocker cycle check run against real Postgres (PGlite) with every migration applied.
 * blockers.test.ts pins statement shapes; this one pins what the recursive walk decides.
 * Concurrency is out of reach here (PGlite is one connection), which is why the project
 * lock's place in the statement order is pinned there instead.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import type { Actor } from '../types.ts';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

vi.mock('../index.ts', () => ({
	query: (text: string, params?: unknown[]) => state.db!.query(text, params),
	transaction: <T>(fn: (client: Transaction) => Promise<T>) => state.db!.transaction(fn),
}));

import { migratedDb } from '../test-support/migrated-db.ts';
import { addBlocker, clearBlocker, listBlockers, setBlockers, BlockerTargetError } from './blockers.ts';

const ACTOR: Actor = { type: 'user', userId: '00000000-0000-0000-0000-000000000000' };

let projectId: string;

async function sql<T>(text: string, params: unknown[] = []): Promise<T[]> {
	return (await state.db!.query<T>(text, params)).rows;
}

/** `item` blocked by `by`, through the service. */
function block(item: number, by: number): Promise<unknown> {
	return addBlocker(projectId, item, { itemNumber: by }, ACTOR);
}

/** The message a write was refused with, failing unless it was a BlockerTargetError. */
async function refusal(attempt: Promise<unknown>): Promise<string> {
	const error = await attempt.then(() => null, (e: unknown) => e);
	expect(error).toBeInstanceOf(BlockerTargetError);
	return (error as BlockerTargetError).message;
}

/** Every open item blocker in the project, so a refusal can be shown to have written nothing. */
async function openEdges(): Promise<string[]> {
	const rows = await sql<{ edge: string }>(
		`SELECT i.number || ' blocked by ' || bi.number AS edge
		 FROM item_blockers b
		 JOIN items i ON i.id = b.item_id
		 JOIN items bi ON bi.id = b.blocker_item_id
		 WHERE b.project_id = $1 AND b.cleared_at IS NULL
		 ORDER BY edge`,
		[projectId]
	);
	return rows.map((row) => row.edge);
}

beforeAll(async () => {
	state.db = await migratedDb();
	const [user] = await sql<{ id: string }>("INSERT INTO users (email) VALUES ('cycles@example.com') RETURNING id");
	const [project] = await sql<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key, item_seq) VALUES ('Cycles', $1, 'cycles', 'CY', 100) RETURNING id",
		[user!.id]
	);
	projectId = project!.id;
}, 60_000);

beforeEach(async () => {
	// Cascades every blocker row, tombstones included.
	await sql('DELETE FROM items WHERE project_id = $1', [projectId]);
	await sql(
		`INSERT INTO items (project_id, type, title, status, sub_status, number)
		 SELECT $1, 'task', 'item ' || n, 'ready', 'not_started', n FROM generate_series(1, 4) n`,
		[projectId]
	);
});

afterAll(async () => {
	await state.db?.close();
});

describe('cycles among open item blockers', () => {
	it('refuses a 2-cycle and writes nothing', async () => {
		await block(1, 2);

		expect(await refusal(block(2, 1))).toBe(
			'Blocking CY-2 on CY-1 would create a cycle: CY-2 is blocked by CY-1, which is blocked by CY-2'
		);
		expect(await openEdges()).toEqual(['1 blocked by 2']);
	});

	it('refuses a 3-cycle, naming every item in it', async () => {
		await block(2, 1);
		await block(3, 2);

		expect(await refusal(block(1, 3))).toBe(
			'Blocking CY-1 on CY-3 would create a cycle: CY-1 is blocked by CY-3, which is blocked by CY-2, which is blocked by CY-1'
		);
		expect(await openEdges()).toEqual(['2 blocked by 1', '3 blocked by 2']);
	});

	it('refuses a replace that would close a cycle, leaving open the blockers it would have cleared', async () => {
		await block(2, 1);
		await block(3, 2);
		await setBlockers(projectId, 1, [{ itemNumber: 4 }, { text: 'waiting on legal' }], ACTOR);

		const attempt = setBlockers(projectId, 1, [{ itemNumber: 3 }, { text: 'new reason' }], ACTOR);

		expect(await refusal(attempt)).toBe(
			'Blocking CY-1 on CY-3 would create a cycle: CY-1 is blocked by CY-3, which is blocked by CY-2, which is blocked by CY-1'
		);
		const open = await listBlockers(projectId, 1);
		expect(open!.map((b) => b.blockerKey ?? b.text).sort()).toEqual(['CY-4', 'waiting on legal']);
	});

	it('accepts a diamond: A blocks C, B blocks C, A blocks B', async () => {
		await block(3, 1);
		await block(3, 2);
		// Closes a loop if direction is ignored, but nothing waits on itself.
		await block(2, 1);
		// Walking up from C reaches A down both sides of the diamond; still no cycle.
		await block(4, 3);

		expect(await openEdges()).toEqual(['2 blocked by 1', '3 blocked by 1', '3 blocked by 2', '4 blocked by 3']);
	});

	it('names the shortest cycle when the new edge would close several', async () => {
		await block(3, 1);
		await block(3, 2);
		await block(2, 1);

		// CY-3 waits on CY-1 directly and through CY-2.
		expect(await refusal(block(1, 3))).toBe(
			'Blocking CY-1 on CY-3 would create a cycle: CY-1 is blocked by CY-3, which is blocked by CY-1'
		);
	});

	it('walks only open item blockers: a cleared one is history, not an edge', async () => {
		const first = await addBlocker(projectId, 1, { itemNumber: 2 }, ACTOR);
		await clearBlocker(projectId, 1, first!.id, ACTOR);

		await block(2, 1);

		expect(await openEdges()).toEqual(['2 blocked by 1']);
	});

	it('ends its walk on a cycle that predates the check, and lets a replace restate an edge inside one', async () => {
		// Written straight to the table, the way a cycle from before the check would sit there.
		await sql(
			`INSERT INTO item_blockers (item_id, project_id, blocker_item_id)
			 SELECT a.id, $1, b.id FROM items a JOIN items b ON b.project_id = a.project_id
			 WHERE a.project_id = $1 AND (a.number, b.number) IN ((1, 2), (2, 1))`,
			[projectId]
		);

		// Walks CY-1, CY-2, CY-1 and has to stop there.
		await block(3, 1);
		// Keeps the open CY-2 row rather than adding it, so there is nothing to refuse.
		await setBlockers(projectId, 1, [{ itemNumber: 2 }, { text: 'waiting on legal' }], ACTOR);

		expect(await openEdges()).toEqual(['1 blocked by 2', '2 blocked by 1', '3 blocked by 1']);
	});
});
