/**
 * Since your last visit against real Postgres (PGlite) with every migration applied: the
 * baseline only moves forward, however its writes arrive; changes come back by kind with
 * the time of the event that makes them, from the item rows and the transition log; and
 * the baseline is one row per account per project.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import type { PGlite, Transaction } from '@electric-sql/pglite';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

vi.mock('../index.ts', () => ({
	query: (text: string, params?: unknown[]) => state.db!.query(text, params),
	transaction: <T>(fn: (client: Transaction) => Promise<T>) => state.db!.transaction(fn),
}));

import { migratedDb } from '../test-support/migrated-db.ts';
import type { AgentActor, UserActor } from '../types.ts';
import type { MapChange } from '@specboard/core/map-changes';
import { createItem, completeItem, startItem, blockItem, unblockItem, updateItem } from './items.ts';
import { addBlocker, clearBlocker } from './blockers.ts';
import { addItemNote } from './notes.ts';
import { recordWorkerActivity } from './workers.ts';
import { READ_SETTLE_SECONDS, advanceMapBaseline, getMapChanges } from './map-changes.ts';

const USER: UserActor = { type: 'user', userId: '00000000-0000-0000-0000-000000000001' };
const AGENT: AgentActor = {
	type: 'agent', userId: USER.userId, clientId: 'oauth-client-7f3a', deviceName: 'personal-laptop',
	sessionId: 'mcp-session-11111111', client: { name: 'claude-code', version: '2.1.0' },
};

let userId: string;
let otherUserId: string;
let projectId: string;
let otherProjectId: string;

async function sql<T>(text: string, params: unknown[] = []): Promise<T[]> {
	return (await state.db!.query<T>(text, params)).rows;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function item(fields: { status?: 'ready' | 'in_progress' | 'blocked' | 'in_review' | 'done' } = {}): Promise<number> {
	return (await createItem(projectId, { title: 'item', type: 'task', origin: { actor: USER }, ...fields })).number;
}

async function idOf(number: number): Promise<string> {
	const [found] = await sql<{ id: string }>('SELECT id FROM items WHERE project_id = $1 AND number = $2', [projectId, number]);
	return found!.id;
}

async function storedBaseline(user = userId, project = projectId): Promise<Date | null> {
	const [found] = await sql<{ last_visit_at: Date }>('SELECT last_visit_at FROM map_baselines WHERE user_id = $1 AND project_id = $2', [user, project]);
	return found?.last_visit_at ?? null;
}

/** The person last looked a moment ago: everything made so far is old, everything after is a change. */
async function lookedJustNow(): Promise<void> {
	await pause(25);
	await sql(
		`INSERT INTO map_baselines (user_id, project_id, last_visit_at) VALUES ($1, $2, clock_timestamp())
		 ON CONFLICT (user_id, project_id) DO UPDATE SET last_visit_at = EXCLUDED.last_visit_at`,
		[userId, projectId]
	);
	await pause(25);
}

async function changes(): Promise<MapChange[]> {
	return (await getMapChanges(userId, projectId, 'MC')).changes;
}

const kindsOf = (all: MapChange[], number: number): string[] => all.filter((change) => change.key === `MC-${number}`).map((change) => change.kind).sort();

/** Pin an item's transition rows to a time, so a test can read the time back off the change. */
async function transitionsAt(number: number, at: Date): Promise<void> {
	await sql('UPDATE item_transitions SET created_at = $2 WHERE item_id = $1', [await idOf(number), at.toISOString()]);
}

beforeAll(async () => {
	state.db = await migratedDb();
	const [user] = await sql<{ id: string }>("INSERT INTO users (email) VALUES ('changes@example.com') RETURNING id");
	userId = user!.id;
	const [other] = await sql<{ id: string }>("INSERT INTO users (email) VALUES ('other@example.com') RETURNING id");
	otherUserId = other!.id;
	const [project] = await sql<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key, item_seq) VALUES ('Changes', $1, 'changes', 'MC', 0) RETURNING id",
		[userId]
	);
	projectId = project!.id;
	const [second] = await sql<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key, item_seq) VALUES ('Second', $1, 'second', 'MD', 0) RETURNING id",
		[userId]
	);
	otherProjectId = second!.id;
}, 60_000);

beforeEach(async () => {
	await sql('DELETE FROM items WHERE project_id = $1', [projectId]);
	await sql('DELETE FROM map_baselines');
});

afterAll(async () => {
	await state.db?.close();
});

describe('the baseline moves forward only', () => {
	const T1 = Date.now() - 3 * 86_400_000;
	const T2 = Date.now() - 2 * 86_400_000;

	it('is created by the first advance, at the time sent', async () => {
		expect(await storedBaseline()).toBeNull();

		const baseline = await advanceMapBaseline(userId, projectId, T1);

		expect(baseline).toBe(T1);
		expect((await storedBaseline())!.getTime()).toBe(T1);
	});

	it('keeps the later value when an earlier one arrives after it', async () => {
		await advanceMapBaseline(userId, projectId, T2);

		const baseline = await advanceMapBaseline(userId, projectId, T1);

		expect(baseline).toBe(T2);
		expect((await storedBaseline())!.getTime()).toBe(T2);
	});

	it('moves ahead for a later one', async () => {
		await advanceMapBaseline(userId, projectId, T1);

		expect(await advanceMapBaseline(userId, projectId, T2)).toBe(T2);
	});

	it('ends on the latest of any order of arrival', async () => {
		const times = Array.from({ length: 25 }, (_, i) => T1 + ((i * 7) % 25) * 60_000);
		const latest = Math.max(...times);

		await Promise.all(times.map((at) => advanceMapBaseline(userId, projectId, at)));

		expect((await storedBaseline())!.getTime()).toBe(latest);
	});

	it('never moves past the server clock, whatever the client sends', async () => {
		const before = Date.now();

		const baseline = await advanceMapBaseline(userId, projectId, Date.now() + 10 * 86_400_000);

		expect(baseline).toBeGreaterThanOrEqual(before - 1);
		expect(baseline).toBeLessThanOrEqual(Date.now() + 1);
	});

	it('is one row per account per project', async () => {
		await advanceMapBaseline(userId, projectId, T2);
		await advanceMapBaseline(otherUserId, projectId, T1);
		await advanceMapBaseline(userId, otherProjectId, T1);

		expect((await storedBaseline())!.getTime()).toBe(T2);
		expect((await storedBaseline(otherUserId))!.getTime()).toBe(T1);
		expect((await storedBaseline(userId, otherProjectId))!.getTime()).toBe(T1);
		expect(await sql('SELECT 1 FROM map_baselines')).toHaveLength(3);
	});

	it('goes with the account and with the project', async () => {
		const [gone] = await sql<{ id: string }>("INSERT INTO users (email) VALUES ('leaving@example.com') RETURNING id");
		const [scratch] = await sql<{ id: string }>(
			"INSERT INTO projects (name, owner_id, slug, key, item_seq) VALUES ('Scratch', $1, 'scratch', 'MS', 0) RETURNING id",
			[userId]
		);
		await advanceMapBaseline(gone!.id, projectId, T1);
		await advanceMapBaseline(userId, scratch!.id, T1);

		await sql('DELETE FROM users WHERE id = $1', [gone!.id]);
		await sql('DELETE FROM projects WHERE id = $1', [scratch!.id]);

		expect(await sql('SELECT 1 FROM map_baselines')).toHaveLength(0);
	});
});

describe('the read', () => {
	it('is a first visit without a baseline: no changes, and a read time to set one from', async () => {
		await item();
		const before = Date.now();

		const read = await getMapChanges(userId, projectId, 'MC');

		expect(read.baseline).toBeNull();
		expect(read.changes).toEqual([]);
		// Stamped from the database's clock, a little behind the statement (READ_SETTLE_SECONDS).
		expect(read.readAt).toBeLessThanOrEqual(before - READ_SETTLE_SECONDS * 1000 + 1000);
		expect(read.readAt).toBeGreaterThan(before - READ_SETTLE_SECONDS * 1000 - 5000);
	});

	it('returns the stored baseline', async () => {
		const at = Date.now() - 86_400_000;
		await advanceMapBaseline(userId, projectId, at);

		expect((await getMapChanges(userId, projectId, 'MC')).baseline).toBe(at);
	});

	it('is empty when nothing happened since the baseline', async () => {
		const n = await item();
		await startItem(projectId, n, AGENT);
		await lookedJustNow();

		expect(await changes()).toEqual([]);
	});

	it('is per account: another person with an older baseline sees what this one has seen', async () => {
		const n = await item();
		await startItem(projectId, n, AGENT);
		await lookedJustNow();
		await advanceMapBaseline(otherUserId, projectId, Date.now() - 86_400_000);

		expect(await changes()).toEqual([]);
		expect((await getMapChanges(otherUserId, projectId, 'MC')).changes.map((c) => c.kind)).toContain('filed');
	});

	it('does not leak another project\'s changes', async () => {
		await lookedJustNow();
		await createItem(otherProjectId, { title: 'elsewhere', type: 'task', origin: { actor: USER } });

		expect(await changes()).toEqual([]);
	});

	it('lists changes oldest first', async () => {
		await lookedJustNow();
		const a = await item();
		await pause(10);
		const b = await item();
		await pause(10);
		const c = await item();

		expect((await changes()).map((change) => change.key)).toEqual([a, b, c].map((n) => `MC-${n}`));
	});
});

describe('filed', () => {
	it('is an item created since the baseline, dated by its creation', async () => {
		const old = await item();
		await lookedJustNow();
		const fresh = await item();

		const all = await changes();

		expect(kindsOf(all, old)).toEqual([]);
		expect(kindsOf(all, fresh)).toEqual(['filed']);
		const [created] = await sql<{ created_at: Date }>('SELECT created_at FROM items WHERE id = $1', [await idOf(fresh)]);
		expect(all.find((change) => change.key === `MC-${fresh}`)!.at).toBe(created!.created_at.getTime());
	});

	it('is only filed when that item was also worked on and logged since: filing says more', async () => {
		await lookedJustNow();
		const n = await item();
		await startItem(projectId, n, AGENT);
		await addItemNote(projectId, n, 'picked it up', AGENT);
		await recordWorkerActivity(projectId, n, AGENT);

		expect(kindsOf(await changes(), n)).toEqual(['filed']);
	});

	it('counts an agent-filed item the same way, with nothing in the change about who filed it', async () => {
		const source = await item();
		await lookedJustNow();
		const found = (await createItem(projectId, { title: 'found', type: 'bug', origin: { actor: AGENT }, discoveredFromNumber: source })).number;

		expect(kindsOf(await changes(), found)).toEqual(['filed']);
	});
});

describe('finished', () => {
	it('is an item that is done and completed since the baseline, dated by completed_at', async () => {
		const n = await item();
		await startItem(projectId, n, AGENT);
		await lookedJustNow();
		await completeItem(projectId, n, AGENT);

		const all = await changes();

		expect(kindsOf(all, n)).toEqual(['finished']);
		const [done] = await sql<{ completed_at: Date }>('SELECT completed_at FROM items WHERE id = $1', [await idOf(n)]);
		expect(all.find((change) => change.key === `MC-${n}`)!.at).toBe(done!.completed_at.getTime());
	});

	it('leaves out an item finished before the baseline', async () => {
		const n = await item();
		await completeItem(projectId, n, AGENT);
		await lookedJustNow();

		expect(kindsOf(await changes(), n)).toEqual([]);
	});

	it('is not finished once the item was reopened, though it was worked on', async () => {
		const n = await item();
		await lookedJustNow();
		await completeItem(projectId, n, AGENT);
		await updateItem(projectId, n, { status: 'in_progress' }, AGENT);

		expect(kindsOf(await changes(), n)).toEqual(['worked_on']);
	});

	it('is the latest finish of an item completed, reopened, and completed again', async () => {
		const n = await item();
		await lookedJustNow();
		await completeItem(projectId, n, AGENT);
		await updateItem(projectId, n, { status: 'in_progress' }, AGENT);
		await pause(10);
		await completeItem(projectId, n, AGENT);

		const all = await changes();

		expect(all.filter((change) => change.key === `MC-${n}` && change.kind === 'finished')).toHaveLength(1);
		const [done] = await sql<{ completed_at: Date }>('SELECT completed_at FROM items WHERE id = $1', [await idOf(n)]);
		expect(all.find((change) => change.kind === 'finished')!.at).toBe(done!.completed_at.getTime());
	});

	it('is only finished, not worked on, however much happened on the way', async () => {
		const n = await item();
		await lookedJustNow();
		await startItem(projectId, n, AGENT);
		await addItemNote(projectId, n, 'done and dusted', AGENT);
		await completeItem(projectId, n, AGENT);

		expect(kindsOf(await changes(), n)).toEqual(['finished']);
	});
});

describe('worked on', () => {
	it('is a transition since the baseline, dated by the transition log', async () => {
		const n = await item();
		await lookedJustNow();
		await startItem(projectId, n, AGENT);
		const at = new Date(Date.now() + 60_000);
		await transitionsAt(n, at);

		const all = await changes();

		expect(kindsOf(all, n)).toEqual(['worked_on']);
		expect(all.find((change) => change.key === `MC-${n}`)!.at).toBe(at.getTime());
	});

	it('is an activity-log entry since the baseline', async () => {
		const n = await item();
		await lookedJustNow();
		const note = await addItemNote(projectId, n, 'chipped away at it', AGENT);

		const all = await changes();

		expect(kindsOf(all, n)).toEqual(['worked_on']);
		expect(all[0]!.at).toBe(new Date(note!.createdAt).getTime());
	});

	it('is a worker write since the baseline', async () => {
		const n = await item();
		await lookedJustNow();
		await recordWorkerActivity(projectId, n, AGENT, 'feat/x');

		const all = await changes();

		expect(kindsOf(all, n)).toEqual(['worked_on']);
		const [worker] = await sql<{ last_seen_at: Date }>('SELECT last_seen_at FROM item_workers WHERE item_id = $1', [await idOf(n)]);
		expect(all[0]!.at).toBe(worker!.last_seen_at.getTime());
	});

	it('is dated by the latest of its events', async () => {
		const n = await item();
		await lookedJustNow();
		await startItem(projectId, n, AGENT);
		await addItemNote(projectId, n, 'progress', AGENT);
		const latest = new Date(Date.now() + 120_000);
		await sql('UPDATE item_notes SET created_at = $2 WHERE item_id = $1', [await idOf(n), latest.toISOString()]);

		expect((await changes()).find((change) => change.kind === 'worked_on')!.at).toBe(latest.getTime());
	});

	it('is not an edit to the title or description, which are not events', async () => {
		const n = await item();
		await lookedJustNow();
		await updateItem(projectId, n, { title: 'typo fixed', description: 'reworded' }, USER);

		expect(kindsOf(await changes(), n)).toEqual([]);
	});

	it('is not a note or move from before the baseline', async () => {
		const n = await item();
		await startItem(projectId, n, AGENT);
		await addItemNote(projectId, n, 'earlier', AGENT);
		await recordWorkerActivity(projectId, n, AGENT);
		await lookedJustNow();

		expect(kindsOf(await changes(), n)).toEqual([]);
	});
});

describe('blocked or held', () => {
	it('is a move to blocked since the baseline, dated by the transition log', async () => {
		const n = await item();
		await lookedJustNow();
		await blockItem(projectId, n, USER);
		const at = new Date(Date.now() + 30_000);
		await transitionsAt(n, at);

		const all = await changes();

		expect(kindsOf(all, n)).toEqual(['blocked', 'worked_on']);
		expect(all.find((change) => change.kind === 'blocked')!.at).toBe(at.getTime());
	});

	it('is an item blocker or a text blocker opened since the baseline, dated by the blocker row', async () => {
		const blocker = await item();
		const waiting = await item();
		const held = await item();
		await lookedJustNow();
		await addBlocker(projectId, waiting, { itemNumber: blocker }, USER);
		await addBlocker(projectId, held, { text: 'legal sign-off' }, USER);

		const all = await changes();

		expect(kindsOf(all, waiting)).toEqual(['blocked']);
		expect(kindsOf(all, held)).toEqual(['blocked']);
		const [opened] = await sql<{ created_at: Date }>('SELECT created_at FROM item_blockers WHERE blocker_text = $1', ['legal sign-off']);
		expect(all.find((change) => change.key === `MC-${held}`)!.at).toBe(opened!.created_at.getTime());
	});

	it('is not a blocker that opened and cleared again', async () => {
		const n = await item();
		await lookedJustNow();
		const blocker = await addBlocker(projectId, n, { text: 'briefly' }, USER);
		await clearBlocker(projectId, n, blocker!.id, USER);

		expect(kindsOf(await changes(), n)).toEqual([]);
	});

	it('is not an item that was blocked and is blocked no more', async () => {
		const n = await item();
		await lookedJustNow();
		await blockItem(projectId, n, USER);
		await unblockItem(projectId, n, USER);

		expect(kindsOf(await changes(), n)).not.toContain('blocked');
	});

	it('is not a hold that was already there at the baseline', async () => {
		const n = await item();
		await addBlocker(projectId, n, { text: 'since forever' }, USER);
		await blockItem(projectId, n, USER);
		await lookedJustNow();

		expect(kindsOf(await changes(), n)).toEqual([]);
	});

	it('is not a sub-status change under a status that was already blocked', async () => {
		const n = await item({ status: 'blocked' });
		await lookedJustNow();
		await updateItem(projectId, n, { subStatus: 'paused' }, USER);

		expect(kindsOf(await changes(), n)).not.toContain('blocked');
	});
});

describe('a question raised', () => {
	it('is a move into needs_input since the baseline that is still there, dated by the transition log', async () => {
		const n = await item();
		await startItem(projectId, n, AGENT);
		await lookedJustNow();
		await updateItem(projectId, n, { subStatus: 'needs_input' }, AGENT);
		const at = new Date(Date.now() + 45_000);
		await transitionsAt(n, at);

		const all = await changes();

		expect(kindsOf(all, n)).toEqual(['question', 'worked_on']);
		expect(all.find((change) => change.kind === 'question')!.at).toBe(at.getTime());
	});

	it('is not one the agent has been answered on and moved past', async () => {
		const n = await item();
		await startItem(projectId, n, AGENT);
		await lookedJustNow();
		await updateItem(projectId, n, { subStatus: 'needs_input' }, AGENT);
		await updateItem(projectId, n, { subStatus: 'in_development' }, AGENT);

		expect(kindsOf(await changes(), n)).toEqual(['worked_on']);
	});

	it('is not a question that was already open at the baseline', async () => {
		const n = await item();
		await updateItem(projectId, n, { subStatus: 'needs_input' }, AGENT);
		await lookedJustNow();
		await addItemNote(projectId, n, 'still waiting', AGENT);

		expect(kindsOf(await changes(), n)).toEqual(['worked_on']);
	});
});

describe('a PR opened', () => {
	it('is a move into pr_open since the baseline, dated by the transition log', async () => {
		const n = await item();
		await startItem(projectId, n, AGENT);
		await lookedJustNow();
		await updateItem(projectId, n, { subStatus: 'pr_open', prUrl: 'https://github.com/acme/roadmap/pull/9' }, AGENT);
		const at = new Date(Date.now() + 90_000);
		await transitionsAt(n, at);

		const all = await changes();

		expect(kindsOf(all, n)).toEqual(['pr_opened', 'worked_on']);
		expect(all.find((change) => change.kind === 'pr_opened')!.at).toBe(at.getTime());
	});

	it('stays a change after the item finished, alongside finished', async () => {
		const n = await item();
		await startItem(projectId, n, AGENT);
		await lookedJustNow();
		await updateItem(projectId, n, { subStatus: 'pr_open' }, AGENT);
		await completeItem(projectId, n, AGENT);

		expect(kindsOf(await changes(), n)).toEqual(['finished', 'pr_opened']);
	});

	it('is not a PR that was already open at the baseline', async () => {
		const n = await item();
		await updateItem(projectId, n, { subStatus: 'pr_open' }, AGENT);
		await lookedJustNow();

		expect(kindsOf(await changes(), n)).toEqual([]);
	});
});

describe('every kind at once', () => {
	it('puts each item under the kinds it earned, and the strip summary is by item', async () => {
		const quiet = await item();
		const working = await item();
		const finishing = await item();
		const asking = await item();
		const reviewing = await item();
		const stuck = await item();
		await lookedJustNow();
		const filed = await item();
		await addItemNote(projectId, working, 'chipping', AGENT);
		await completeItem(projectId, finishing, AGENT);
		await updateItem(projectId, asking, { subStatus: 'needs_input' }, AGENT);
		await updateItem(projectId, reviewing, { subStatus: 'pr_open' }, AGENT);
		await addBlocker(projectId, stuck, { text: 'waiting on design' }, USER);

		const all = await changes();

		expect(kindsOf(all, quiet)).toEqual([]);
		expect(kindsOf(all, working)).toEqual(['worked_on']);
		expect(kindsOf(all, finishing)).toEqual(['finished']);
		expect(kindsOf(all, asking)).toEqual(['question', 'worked_on']);
		expect(kindsOf(all, reviewing)).toEqual(['pr_opened', 'worked_on']);
		expect(kindsOf(all, stuck)).toEqual(['blocked']);
		expect(kindsOf(all, filed)).toEqual(['filed']);
		const times = all.map((change) => change.at);
		expect(times).toEqual([...times].sort((a, b) => a - b));
	});
});
