/**
 * started_at, completed_at, and the transition log, run against real Postgres (PGlite)
 * with every migration applied. The stamps come from the items_status_stamps trigger and
 * the log rows from the item service; each path that writes a status is driven the way
 * its caller drives it (the MCP shortcuts, the REST create and PUT, a board drag, the
 * parent rollup), and each test reads back what the database holds.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import type { PGlite, Transaction } from '@electric-sql/pglite';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

vi.mock('../index.ts', () => ({
	query: (text: string, params?: unknown[]) => state.db!.query(text, params),
	transaction: <T>(fn: (client: Transaction) => Promise<T>) => state.db!.transaction(fn),
}));

import { migratedDb } from '../test-support/migrated-db.ts';
import type { AgentActor, ItemStatus, SubStatus, UserActor } from '../types.ts';
import { createItem, completeItem, startItem, blockItem, unblockItem, updateItem, getItems } from './items.ts';

const USER: UserActor = { type: 'user', userId: '00000000-0000-0000-0000-000000000001' };
const AGENT: AgentActor = { type: 'agent', userId: USER.userId, clientId: 'client-1', deviceName: 'laptop', sessionId: 's-1' };
const ORIGIN = { actor: USER };

let projectId: string;

async function sql<T>(text: string, params: unknown[] = []): Promise<T[]> {
	return (await state.db!.query<T>(text, params)).rows;
}

interface Stamps {
	status: ItemStatus;
	sub_status: SubStatus | null;
	started_at: Date | null;
	completed_at: Date | null;
}

async function stamps(number: number): Promise<Stamps> {
	const [row] = await sql<Stamps>(
		'SELECT status, sub_status, started_at, completed_at FROM items WHERE project_id = $1 AND number = $2',
		[projectId, number]
	);
	return row!;
}

interface Logged {
	from_status: ItemStatus | null;
	to_status: ItemStatus;
	from_sub_status: SubStatus | null;
	to_sub_status: SubStatus | null;
	actor: Record<string, unknown>;
	created_at: Date;
}

/** An item's transition rows, oldest first. xmin breaks a tie between two writes stamped in one clock tick. */
async function transitions(number: number): Promise<Logged[]> {
	return sql<Logged>(
		`SELECT t.from_status, t.to_status, t.from_sub_status, t.to_sub_status, t.actor, t.created_at
		 FROM item_transitions t JOIN items i ON i.id = t.item_id
		 WHERE i.project_id = $1 AND i.number = $2
		 ORDER BY t.created_at, t.xmin::text::bigint`,
		[projectId, number]
	);
}

const moves = async (number: number): Promise<string[]> =>
	(await transitions(number)).map((t) => `${t.from_status}/${t.from_sub_status} -> ${t.to_status}/${t.to_sub_status}`);

async function task(fields: { status?: ItemStatus; parentNumber?: number } = {}): Promise<number> {
	const created = await createItem(projectId, { title: 'task', type: 'task', origin: ORIGIN, ...fields });
	return created.number;
}

beforeAll(async () => {
	state.db = await migratedDb();
	const [user] = await sql<{ id: string }>("INSERT INTO users (email) VALUES ('stamps@example.com') RETURNING id");
	const [project] = await sql<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key, item_seq) VALUES ('Stamps', $1, 'stamps', 'ST', 0) RETURNING id",
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

describe('the MCP status shortcuts', () => {
	it('status in_progress starts the item and logs the agent', async () => {
		const n = await task();

		await startItem(projectId, n, AGENT);

		const after = await stamps(n);
		expect(after.started_at).toBeInstanceOf(Date);
		expect(after.completed_at).toBeNull();
		const [row] = await transitions(n);
		expect(row).toMatchObject({ from_status: 'ready', to_status: 'in_progress', actor: AGENT });
		expect(row!.created_at.getTime()).toBeGreaterThanOrEqual(after.started_at!.getTime());
	});

	it('status in_progress with sub_status alongside logs one move, not two', async () => {
		const n = await task();

		// update_item names the shortcut status in the fields, then the shortcut restates it.
		await updateItem(projectId, n, { subStatus: 'in_development', status: 'in_progress' }, AGENT);
		await startItem(projectId, n, AGENT);

		expect(await moves(n)).toEqual(['ready/not_started -> in_progress/in_development']);
	});

	it('status done completes it and keeps when it started', async () => {
		const n = await task();
		await startItem(projectId, n, AGENT);
		const { started_at: started } = await stamps(n);

		await completeItem(projectId, n, AGENT);

		const after = await stamps(n);
		expect(after.started_at).toEqual(started);
		expect(after.completed_at).toBeInstanceOf(Date);
		expect(after.completed_at!.getTime()).toBeGreaterThanOrEqual(started!.getTime());
		expect(await moves(n)).toEqual([
			'ready/not_started -> in_progress/not_started',
			'in_progress/not_started -> done/not_started',
		]);
	});

	it('status blocked and a bare status ready log both moves and stamp nothing', async () => {
		const n = await task();

		await blockItem(projectId, n, AGENT);
		await unblockItem(projectId, n, AGENT);

		expect(await stamps(n)).toMatchObject({ started_at: null, completed_at: null });
		expect(await moves(n)).toEqual([
			'ready/not_started -> blocked/not_started',
			'blocked/not_started -> ready/not_started',
		]);
		expect((await transitions(n)).every((t) => t.actor.type === 'agent')).toBe(true);
	});

	it('a shortcut that restates the status logs nothing and moves no stamp', async () => {
		const n = await task();
		await completeItem(projectId, n, AGENT);
		const before = await stamps(n);

		await completeItem(projectId, n, AGENT);

		expect(await stamps(n)).toEqual(before);
		expect(await transitions(n)).toHaveLength(1);
	});
});

describe('the general update', () => {
	it('a sub_status that derives in_progress starts the item; complete finishes it', async () => {
		const n = await task();

		await updateItem(projectId, n, { subStatus: 'pr_open' }, AGENT);
		expect((await stamps(n)).started_at).toBeInstanceOf(Date);

		await updateItem(projectId, n, { subStatus: 'complete' }, AGENT);
		expect(await stamps(n)).toMatchObject({ status: 'done', sub_status: 'complete' });
		expect((await stamps(n)).completed_at).toBeInstanceOf(Date);
		expect(await moves(n)).toEqual([
			'ready/not_started -> in_progress/pr_open',
			'in_progress/pr_open -> done/complete',
		]);
	});

	it('entering in_review starts an item too', async () => {
		const n = await task();

		await updateItem(projectId, n, { status: 'in_review' }, USER);

		expect((await stamps(n)).started_at).toBeInstanceOf(Date);
	});

	it('a sub_status move under a status that holds is still a transition', async () => {
		const n = await task();
		await updateItem(projectId, n, { subStatus: 'in_development' }, AGENT);

		await updateItem(projectId, n, { subStatus: 'needs_input' }, AGENT);

		expect(await moves(n)).toEqual([
			'ready/not_started -> in_progress/in_development',
			'in_progress/in_development -> in_progress/needs_input',
		]);
	});

	it('straight from ready to done never started', async () => {
		const n = await task();

		await updateItem(projectId, n, { status: 'done' }, USER);

		expect(await stamps(n)).toMatchObject({ started_at: null, completed_at: expect.any(Date) });
	});
});

describe('a reopen', () => {
	it('keeps started_at and clears completed_at', async () => {
		const n = await task();
		await startItem(projectId, n, AGENT);
		await completeItem(projectId, n, AGENT);
		const { started_at: started } = await stamps(n);

		await updateItem(projectId, n, { status: 'in_progress', subStatus: 'in_development' }, USER);

		expect(await stamps(n)).toMatchObject({ status: 'in_progress', started_at: started, completed_at: null });
	});

	it('back to ready keeps started_at too, and finishing again stamps a new completion', async () => {
		const n = await task();
		await startItem(projectId, n, AGENT);
		await completeItem(projectId, n, AGENT);
		const first = await stamps(n);

		await unblockItem(projectId, n, USER);
		expect(await stamps(n)).toMatchObject({ status: 'ready', started_at: first.started_at, completed_at: null });

		await startItem(projectId, n, AGENT);
		await completeItem(projectId, n, AGENT);
		const second = await stamps(n);
		expect(second.started_at).toEqual(first.started_at);
		expect(second.completed_at!.getTime()).toBeGreaterThanOrEqual(first.completed_at!.getTime());
		expect(await transitions(n)).toHaveLength(5);
	});
});

describe('the REST create', () => {
	it('a create that names a status stamps it and logs it from nothing, as the creator', async () => {
		const started = await task({ status: 'in_progress' });
		const done = await task({ status: 'done' });

		expect((await stamps(started)).started_at).toBeInstanceOf(Date);
		expect(await stamps(done)).toMatchObject({ started_at: null, completed_at: expect.any(Date) });
		expect(await transitions(started)).toEqual([expect.objectContaining({
			from_status: null, from_sub_status: null, to_status: 'in_progress', to_sub_status: 'in_development', actor: USER,
		})]);
		expect(await moves(done)).toEqual(['null/null -> done/complete']);
	});

	it('a create left on the default logs nothing and stamps nothing', async () => {
		const n = await task();

		expect(await stamps(n)).toMatchObject({ started_at: null, completed_at: null });
		expect(await transitions(n)).toEqual([]);
	});

	it('responses carry both stamps', async () => {
		const created = await createItem(projectId, { title: 'done', status: 'done', origin: ORIGIN });
		expect(created.completedAt).toBeInstanceOf(Date);
		expect(created.startedAt).toBeNull();

		const { items: [read] } = await getItems({ projectId, itemNumber: created.number });
		expect(read).toMatchObject({ startedAt: null, completedAt: created.completedAt });
	});
});

describe('the web client save', () => {
	it('a board drag moves the status under a restated sub_status: one row, by the person', async () => {
		const n = await task();

		await updateItem(projectId, n, { title: 'task', status: 'in_progress', subStatus: 'not_started', rank: 2 }, USER);

		expect((await stamps(n)).started_at).toBeInstanceOf(Date);
		expect(await transitions(n)).toEqual([expect.objectContaining({
			from_status: 'ready', to_status: 'in_progress', from_sub_status: 'not_started', to_sub_status: 'not_started', actor: USER,
		})]);
	});

	it('a save that restates status and sub_status logs nothing and moves no stamp', async () => {
		const n = await task();
		await startItem(projectId, n, AGENT);
		const before = await stamps(n);

		await updateItem(projectId, n, { title: 'renamed', description: 'more', status: 'in_progress', subStatus: 'not_started', rank: 3 }, USER);

		expect(await stamps(n)).toEqual(before);
		expect(await transitions(n)).toHaveLength(1);
	});

	it('a title edit logs nothing', async () => {
		const n = await task();

		await updateItem(projectId, n, { title: 'renamed' }, USER);

		expect(await transitions(n)).toEqual([]);
	});
});

describe('the parent rollup', () => {
	it('a parent the rollup starts is stamped and logged as the system; rolling back keeps its start', async () => {
		const parent = await task();
		const child = await task({ parentNumber: parent });

		await startItem(projectId, child, AGENT);
		const started = await stamps(parent);
		expect(started).toMatchObject({ status: 'in_progress', started_at: expect.any(Date) });

		await updateItem(projectId, child, { status: 'ready' }, AGENT);
		expect(await stamps(parent)).toMatchObject({ status: 'ready', started_at: started.started_at, completed_at: null });

		const rows = await transitions(parent);
		expect(rows.map((r) => `${r.from_status} -> ${r.to_status}`)).toEqual(['ready -> in_progress', 'in_progress -> ready']);
		expect(rows.every((r) => r.actor.type === 'system' && r.actor.cause === 'parent_rollup')).toBe(true);
		// The child's own moves are the agent's.
		expect((await transitions(child)).every((r) => r.actor.type === 'agent')).toBe(true);
	});

	it('a child created already started promotes its parent, logged as the system', async () => {
		const parent = await task();

		await task({ parentNumber: parent, status: 'in_progress' });

		expect(await transitions(parent)).toEqual([expect.objectContaining({
			from_status: 'ready', to_status: 'in_progress', actor: { type: 'system', cause: 'parent_rollup' },
		})]);
		expect((await stamps(parent)).started_at).toBeInstanceOf(Date);
	});
});

describe('the trigger owns the stamps', () => {
	it('an UPDATE cannot write either stamp', async () => {
		const n = await task();

		await sql(
			"UPDATE items SET started_at = '2001-01-01', completed_at = '2001-01-01', title = 'x' WHERE project_id = $1 AND number = $2",
			[projectId, n]
		);

		expect(await stamps(n)).toMatchObject({ started_at: null, completed_at: null });
	});

	it('an INSERT may place history in the past, but completed_at only survives on a done row', async () => {
		await sql(
			`INSERT INTO items (project_id, title, status, number, started_at, completed_at) VALUES
			 ($1, 'old', 'done', 901, '2001-01-01', '2001-02-01'),
			 ($1, 'reopened', 'ready', 902, '2001-01-01', '2001-02-01')`,
			[projectId]
		);

		expect(await stamps(901)).toMatchObject({ started_at: new Date('2001-01-01'), completed_at: new Date('2001-02-01') });
		expect(await stamps(902)).toMatchObject({ started_at: new Date('2001-01-01'), completed_at: null });
	});

	it('a status write after the stamps shipped leaves an item that moved before them unstamped', async () => {
		// An item that went in progress before 033, as it stands after the migration: no backfill.
		await sql('ALTER TABLE items DISABLE TRIGGER items_status_stamps');
		await sql("INSERT INTO items (project_id, title, status, sub_status, number) VALUES ($1, 'old', 'in_progress', 'not_started', 903)", [projectId]);
		await sql('ALTER TABLE items ENABLE TRIGGER items_status_stamps');

		await updateItem(projectId, 903, { title: 'renamed', status: 'in_progress', subStatus: 'not_started' }, USER);
		expect((await stamps(903)).started_at).toBeNull();

		await completeItem(projectId, 903, USER);
		expect(await stamps(903)).toMatchObject({ started_at: null, completed_at: expect.any(Date) });
	});
});

describe('the log', () => {
	it('refuses a row that records no move', async () => {
		const n = await task();
		const [item] = await sql<{ id: string }>('SELECT id FROM items WHERE project_id = $1 AND number = $2', [projectId, n]);

		await expect(sql(
			`INSERT INTO item_transitions (item_id, project_id, from_status, to_status, from_sub_status, to_sub_status, actor)
			 VALUES ($1, $2, 'ready', 'ready', 'not_started', 'not_started', '{"type":"system","cause":"test"}')`,
			[item!.id, projectId]
		)).rejects.toThrow(/item_transitions_moved/);
	});

	it('commits with the status write or not at all', async () => {
		const n = await task();
		await sql(`CREATE FUNCTION fail_transition() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'log refused'; END; $$ LANGUAGE plpgsql`);
		await sql('CREATE TRIGGER fail_transition BEFORE INSERT ON item_transitions FOR EACH ROW EXECUTE FUNCTION fail_transition()');
		try {
			await expect(startItem(projectId, n, AGENT)).rejects.toThrow(/log refused/);
			await expect(createItem(projectId, { title: 'named', status: 'done', origin: ORIGIN })).rejects.toThrow(/log refused/);
		} finally {
			await sql('DROP TRIGGER fail_transition ON item_transitions');
			await sql('DROP FUNCTION fail_transition()');
		}

		expect(await stamps(n)).toMatchObject({ status: 'ready', started_at: null });
		expect(await sql("SELECT 1 FROM items WHERE project_id = $1 AND title = 'named'", [projectId])).toEqual([]);
	});
});
