/**
 * The Map read against real Postgres (PGlite) with every migration applied: the whole
 * tree at any depth, the time-anchor rules, which blocker links come back, session keys,
 * what never leaves the server, the payload on a generated 2,000-item project, and
 * folding finished families past the read cap.
 */

import { gzipSync } from 'node:zlib';
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import type { PGlite, Transaction } from '@electric-sql/pglite';

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));

vi.mock('../index.ts', () => ({
	query: (text: string, params?: unknown[]) => state.db!.query(text, params),
	transaction: <T>(fn: (client: Transaction) => Promise<T>) => state.db!.transaction(fn),
}));

import { migratedDb } from '../test-support/migrated-db.ts';
import { generateMapProject } from '../test-support/map-fixture.ts';
import type { AgentActor, ItemStatus, UserActor } from '../types.ts';
import { createItem, completeItem, startItem, updateItem } from './items.ts';
import { addBlocker, clearBlocker } from './blockers.ts';
import { addSpec } from './specs.ts';
import { recordWorkerActivity } from './workers.ts';
import { encodeMapRead, type MapItemRow } from '@specboard/core/map-read';
import { agentSessionKey, getProjectMap, summarizeFinishedFamilies } from './map.ts';

const USER: UserActor = { type: 'user', userId: '00000000-0000-0000-0000-000000000001' };
const AGENT: AgentActor = {
	type: 'agent', userId: USER.userId, clientId: 'oauth-client-7f3a', deviceName: 'personal-laptop',
	sessionId: 'mcp-session-11111111', client: { name: 'claude-code', version: '2.1.0' },
};
const OTHER_SESSION: AgentActor = { ...AGENT, sessionId: 'mcp-session-22222222' };

let userId: string;
let projectId: string;

async function sql<T>(text: string, params: unknown[] = []): Promise<T[]> {
	return (await state.db!.query<T>(text, params)).rows;
}

async function item(fields: { status?: ItemStatus; parentNumber?: number; type?: 'epic' | 'task' | 'bug' } = {}): Promise<number> {
	return (await createItem(projectId, { title: 'item', type: 'task', origin: { actor: USER }, ...fields })).number;
}

async function read(): Promise<Map<string, MapItemRow>> {
	const { items } = await getProjectMap(projectId);
	return new Map(items.map((row) => [row.key, row]));
}

async function row(number: number): Promise<MapItemRow> {
	return (await read()).get(`MP-${number}`)!;
}

/** Push an item's filing back in time, so each later event is unambiguously newer. */
async function filedAt(number: number, at: string): Promise<void> {
	await sql('UPDATE items SET created_at = $3 WHERE project_id = $1 AND number = $2', [projectId, number, at]);
}

async function idOf(number: number): Promise<string> {
	const [found] = await sql<{ id: string }>('SELECT id FROM items WHERE project_id = $1 AND number = $2', [projectId, number]);
	return found!.id;
}

beforeAll(async () => {
	state.db = await migratedDb();
	const [user] = await sql<{ id: string }>("INSERT INTO users (email) VALUES ('map@example.com') RETURNING id");
	userId = user!.id;
	const [project] = await sql<{ id: string }>(
		"INSERT INTO projects (name, owner_id, slug, key, item_seq) VALUES ('Map', $1, 'map', 'MP', 0) RETURNING id",
		[userId]
	);
	projectId = project!.id;
}, 60_000);

beforeEach(async () => {
	await sql('DELETE FROM items WHERE project_id = $1', [projectId]);
});

afterAll(async () => {
	await state.db?.close();
});

describe('the whole tree', () => {
	it('returns every item at every depth with its parent key, and nothing the Map does not draw', async () => {
		const root = await item({ type: 'epic' });
		let parent = root;
		const chain = [root];
		for (let depth = 1; depth <= 4; depth++) {
			parent = await item({ type: depth < 4 ? 'epic' : 'task', parentNumber: parent });
			chain.push(parent);
		}
		const loose = await item({ type: 'bug' });

		const rows = await read();

		expect([...rows.keys()]).toEqual([...chain, loose].map((n) => `MP-${n}`));
		expect(chain.map((n) => rows.get(`MP-${n}`)!.parentKey)).toEqual([null, ...chain.slice(0, -1).map((n) => `MP-${n}`)]);
		expect(rows.get(`MP-${loose}`)!.parentKey).toBeNull();
		expect(Object.keys(rows.get(`MP-${root}`)!).sort()).toEqual([
			'blocked', 'blockers', 'completedAt', 'createdAt', 'discoveredFromKey', 'key', 'originActorType', 'parentKey',
			'prUrl', 'rank', 'specCount', 'startedAt', 'status', 'subStatus', 'textBlockerCount', 'timeAnchor', 'title',
			'type', 'workers',
		]);
	});

	it('carries status, provenance, PR, and spec count', async () => {
		const source = await item();
		const filed = (await createItem(projectId, {
			title: 'found it', type: 'bug', origin: { actor: AGENT }, discoveredFromNumber: source,
		})).number;
		await updateItem(projectId, filed, { subStatus: 'pr_open', prUrl: 'https://github.com/acme/roadmap/pull/9' }, AGENT);
		await addSpec(projectId, filed, '/docs/specs/a.md', 'product');
		await addSpec(projectId, filed, '/docs/specs/b.md', 'technical');

		expect(await row(filed)).toMatchObject({
			type: 'bug', title: 'found it', status: 'in_progress', subStatus: 'pr_open', blocked: false,
			discoveredFromKey: `MP-${source}`, originActorType: 'agent', prUrl: 'https://github.com/acme/roadmap/pull/9', specCount: 2,
		});
		expect(await row(source)).toMatchObject({ discoveredFromKey: null, originActorType: 'user', prUrl: null, specCount: 0 });
	});

	it('reads blocked from a status hold or an open blocker row, and counts open text blockers', async () => {
		const held = await item({ status: 'blocked' });
		const waiting = await item();
		await addBlocker(projectId, waiting, { text: 'legal sign-off' }, USER);
		await addBlocker(projectId, waiting, { text: 'design review' }, USER);
		const cleared = await item();
		const removed = await addBlocker(projectId, cleared, { text: 'gone' }, USER);
		await clearBlocker(projectId, cleared, removed!.id, USER);

		const rows = await read();
		expect(rows.get(`MP-${held}`)).toMatchObject({ blocked: true, textBlockerCount: 0 });
		expect(rows.get(`MP-${waiting}`)).toMatchObject({ blocked: true, textBlockerCount: 2 });
		expect(rows.get(`MP-${cleared}`)).toMatchObject({ blocked: false, textBlockerCount: 0 });
	});
});

describe('the time anchor', () => {
	const FILED = '2026-09-01T00:00:00.000Z';
	const LATER = '2026-09-10T00:00:00.000Z';

	it('is created_at for an item nothing has happened to', async () => {
		const n = await item();
		await filedAt(n, FILED);

		expect((await row(n)).timeAnchor).toBe(FILED);
	});

	it.each([
		['a transition', `INSERT INTO item_transitions (item_id, project_id, from_status, to_status, actor, created_at)
			VALUES ($1, $2, 'ready', 'in_progress', '{"type":"user","userId":"u"}', $3)`],
		['an activity-log entry', `INSERT INTO item_notes (item_id, note, created_at)
			SELECT id, 'note', $3 FROM items WHERE id = $1 AND project_id = $2`],
		['a blocker opened', `INSERT INTO item_blockers (item_id, project_id, blocker_text, created_at)
			VALUES ($1, $2, 'hold', $3)`],
		['a blocker cleared', `INSERT INTO item_blockers (item_id, project_id, blocker_text, created_at, cleared_at, cleared_by)
			VALUES ($1, $2, 'hold', '2026-09-02T00:00:00Z', $3, '{"type":"user","userId":"u"}')`],
		['an agent write', `INSERT INTO item_workers (item_id, project_id, actor, started_at, last_seen_at, ended_at)
			VALUES ($1, $2, '{"type":"agent","userId":"u","clientId":"c","sessionId":"s"}', '2026-09-02T00:00:00Z', $3, $3)`],
	])('moves to %s', async (_event, insert) => {
		const n = await item();
		await filedAt(n, FILED);
		await sql(insert, [await idOf(n), projectId, LATER]);

		expect((await row(n)).timeAnchor).toBe(LATER);
	});

	it('takes the newest of several events', async () => {
		const n = await item();
		await filedAt(n, FILED);
		const id = await idOf(n);
		await sql("INSERT INTO item_notes (item_id, note, created_at) VALUES ($1, 'a', '2026-09-05T00:00:00Z')", [id]);
		await sql("INSERT INTO item_notes (item_id, note, created_at) VALUES ($1, 'b', $2)", [id, LATER]);
		await sql(`INSERT INTO item_transitions (item_id, project_id, from_status, to_status, actor, created_at)
			VALUES ($1, $2, 'ready', 'in_progress', '{"type":"user","userId":"u"}', '2026-09-07T00:00:00Z')`, [id, projectId]);

		expect((await row(n)).timeAnchor).toBe(LATER);
	});

	it('ignores title and description edits, which only move updated_at', async () => {
		const n = await item();
		await filedAt(n, FILED);
		await updateItem(projectId, n, { title: 'typo fixed', description: 'reworded' }, USER);

		expect((await row(n)).timeAnchor).toBe(FILED);
	});

	it('is completed_at for a done item, whatever happened after', async () => {
		const n = await item();
		await completeItem(projectId, n, USER);
		await sql("INSERT INTO item_notes (item_id, note, created_at) VALUES ($1, 'afterword', now() + interval '1 day')", [await idOf(n)]);

		const done = await row(n);
		expect(done.completedAt).not.toBeNull();
		expect(done.timeAnchor).toBe(done.completedAt);
	});

	it('falls back to the latest event for a done item that finished before the stamps existed', async () => {
		const n = await item();
		await filedAt(n, FILED);
		// A row finished before 033 has no completed_at, and the trigger refuses to write one
		// on UPDATE, so it stands aside to recreate that row.
		await sql('ALTER TABLE items DISABLE TRIGGER items_status_stamps');
		await sql("UPDATE items SET status = 'done', sub_status = 'complete', completed_at = NULL WHERE id = $1", [await idOf(n)]);
		await sql('ALTER TABLE items ENABLE TRIGGER items_status_stamps');
		await sql("INSERT INTO item_notes (item_id, note, created_at) VALUES ($1, 'shipped', $2)", [await idOf(n), LATER]);

		expect(await row(n)).toMatchObject({ status: 'done', completedAt: null, timeAnchor: LATER });
	});
});

describe('blocker links', () => {
	it('keeps a link that cleared because the blocker finished, marked satisfied with when', async () => {
		const blocker = await item();
		const blocked = await item();
		await addBlocker(projectId, blocked, { itemNumber: blocker }, USER);
		await completeItem(projectId, blocker, USER);

		const link = (await row(blocked)).blockers[0]!;
		const [stored] = await sql<{ cleared_at: Date }>('SELECT cleared_at FROM item_blockers WHERE item_id = $1', [await idOf(blocked)]);
		expect(link).toEqual({ blockerKey: `MP-${blocker}`, state: 'satisfied', satisfiedAt: stored!.cleared_at.toISOString() });
		expect((await row(blocked)).blocked).toBe(false);
	});

	it('keeps a link that cleared because the blocked item finished over it', async () => {
		const blocker = await item();
		const blocked = await item();
		await addBlocker(projectId, blocked, { itemNumber: blocker }, USER);
		await completeItem(projectId, blocked, USER);

		expect((await row(blocked)).blockers).toEqual([expect.objectContaining({ blockerKey: `MP-${blocker}`, state: 'satisfied' })]);
	});

	it('returns an open link as open, and drops one someone removed by hand', async () => {
		const first = await item();
		const second = await item();
		const blocked = await item();
		await addBlocker(projectId, blocked, { itemNumber: first }, USER);
		const removed = await addBlocker(projectId, blocked, { itemNumber: second }, AGENT);
		await clearBlocker(projectId, blocked, removed!.id, USER);

		expect((await row(blocked)).blockers).toEqual([{ blockerKey: `MP-${first}`, state: 'open' }]);
	});

	it('drops a link whose latest word was a removal, even after an earlier satisfied clear', async () => {
		const blocker = await item();
		const blocked = await item();
		await addBlocker(projectId, blocked, { itemNumber: blocker }, USER);
		await completeItem(projectId, blocker, USER);
		await updateItem(projectId, blocker, { status: 'in_progress' }, USER);
		const reopened = await addBlocker(projectId, blocked, { itemNumber: blocker }, USER);
		await clearBlocker(projectId, blocked, reopened!.id, USER);

		expect((await row(blocked)).blockers).toEqual([]);
	});
});

describe('worker episodes', () => {
	it('carry device, client, branch, last write, and a session key that is stable within a session', async () => {
		const one = await item();
		const two = await item();
		await startItem(projectId, one, AGENT);
		await startItem(projectId, two, AGENT);
		await recordWorkerActivity(projectId, one, AGENT, 'feat/MP-1-map');
		await recordWorkerActivity(projectId, two, AGENT);

		const rows = await read();
		const [onOne] = rows.get(`MP-${one}`)!.workers;
		const [onTwo] = rows.get(`MP-${two}`)!.workers;
		const [stored] = await sql<{ started_at: Date; last_seen_at: Date }>('SELECT started_at, last_seen_at FROM item_workers WHERE item_id = $1', [await idOf(one)]);
		expect(onOne).toEqual({
			sessionKey: agentSessionKey(AGENT),
			deviceName: 'personal-laptop',
			client: 'claude-code',
			branch: 'feat/MP-1-map',
			startedAt: stored!.started_at.toISOString(),
			lastWriteAt: stored!.last_seen_at.toISOString(),
		});
		expect(onTwo!.sessionKey).toBe(onOne!.sessionKey);
	});

	it('tells two sessions on one device apart', async () => {
		const n = await item();
		await startItem(projectId, n, AGENT);
		await recordWorkerActivity(projectId, n, AGENT);
		await recordWorkerActivity(projectId, n, OTHER_SESSION);

		const keys = (await row(n)).workers.map((w) => w.sessionKey);
		expect(keys).toHaveLength(2);
		expect(new Set(keys).size).toBe(2);
		expect(keys.every((key) => /^[A-Za-z0-9_-]{16}$/.test(key))).toBe(true);
	});

	it('leaves ended episodes out', async () => {
		const n = await item();
		await startItem(projectId, n, AGENT);
		await recordWorkerActivity(projectId, n, AGENT);
		await completeItem(projectId, n, AGENT);

		expect((await row(n)).workers).toEqual([]);
	});

	it('never sends a user, client, or session id', async () => {
		const n = await (await createItem(projectId, { title: 'agent filed', type: 'task', origin: { actor: AGENT } })).number;
		await startItem(projectId, n, AGENT);
		await recordWorkerActivity(projectId, n, AGENT);
		await recordWorkerActivity(projectId, n, OTHER_SESSION);
		await addBlocker(projectId, n, { text: 'hold' }, AGENT);

		const payload = JSON.stringify(await getProjectMap(projectId));
		for (const id of [userId, USER.userId, AGENT.clientId, AGENT.sessionId!, OTHER_SESSION.sessionId!]) {
			expect(payload).not.toContain(id);
		}
		expect(payload).not.toMatch(/"(userId|clientId|sessionId)"/);
	});
});

/** Moves every stamp a delta compares an hour back, so a read's cursor lands after all of it. Triggers off, or updated_at would come straight back to now. */
async function settle(): Promise<void> {
	await sql('SET session_replication_role = replica');
	await sql("UPDATE items SET updated_at = updated_at - interval '1 hour' WHERE project_id = $1", [projectId]);
	await sql(
		"UPDATE item_workers SET started_at = started_at - interval '1 hour', last_seen_at = last_seen_at - interval '1 hour', ended_at = ended_at - interval '1 hour' WHERE project_id = $1",
		[projectId]
	);
	await sql('SET session_replication_role = DEFAULT');
}

async function keysSince(cursor: number): Promise<string[]> {
	const delta = await getProjectMap(projectId, cursor);
	expect(delta.delta).toBe(true);
	return delta.items.map((r) => r.key);
}

describe('a delta', () => {
	it('carries nothing when nothing changed since the cursor', async () => {
		await item();
		await item();
		await settle();
		const { cursor, delta } = await getProjectMap(projectId);

		expect(delta).toBe(false);
		expect(await keysSince(cursor)).toEqual([]);
	});

	it('takes its cursor from the database clock, a second back, never later', async () => {
		const [before] = await sql<{ ms: string }>('SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS ms');
		const { cursor } = await getProjectMap(projectId);
		const [after] = await sql<{ ms: string }>('SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS ms');

		expect(cursor).toBeGreaterThanOrEqual(Number(before!.ms) - 1000);
		expect(cursor).toBeLessThanOrEqual(Number(after!.ms) - 1000);
	});

	it('carries a changed item whole, as the full read has it, and nothing else', async () => {
		const one = await item();
		const two = await item();
		await item();
		await settle();
		const { cursor } = await getProjectMap(projectId);

		await updateItem(projectId, two, { title: 'renamed' }, USER);
		await addBlocker(projectId, one, { itemNumber: two }, USER);

		const delta = await getProjectMap(projectId, cursor);
		const whole = await read();
		expect(delta.items.map((r) => r.key)).toEqual([`MP-${one}`, `MP-${two}`]);
		for (const changed of delta.items) expect(changed).toEqual(whole.get(changed.key));
		expect(delta.items[0]!.blockers).toEqual([{ blockerKey: `MP-${two}`, state: 'open' }]);
	});

	it('includes a row stamped exactly at the cursor, so the overlap is never a gap', async () => {
		const n = await item();
		await settle();
		const [stamp] = await sql<{ ms: string }>(
			'SELECT FLOOR(EXTRACT(EPOCH FROM updated_at) * 1000)::bigint AS ms FROM items WHERE project_id = $1 AND number = $2', [projectId, n]
		);

		expect(await keysSince(Number(stamp!.ms))).toEqual([`MP-${n}`]);
	});

	it('carries an item an agent wrote to, though the write leaves updated_at alone, with its anchor moved', async () => {
		const n = await item();
		await item();
		await startItem(projectId, n, AGENT);
		await settle();
		const { cursor } = await getProjectMap(projectId);
		const [stamp] = await sql<{ updated_at: Date }>('SELECT updated_at FROM items WHERE project_id = $1 AND number = $2', [projectId, n]);

		await recordWorkerActivity(projectId, n, AGENT);

		const [after] = await sql<{ updated_at: Date }>('SELECT updated_at FROM items WHERE project_id = $1 AND number = $2', [projectId, n]);
		expect(after!.updated_at).toEqual(stamp!.updated_at);
		const delta = await getProjectMap(projectId, cursor);
		expect(delta.items.map((r) => r.key)).toEqual([`MP-${n}`]);
		const [episode] = delta.items[0]!.workers;
		expect(Date.parse(episode!.lastWriteAt)).toBeGreaterThanOrEqual(cursor);
		expect(delta.items[0]!.timeAnchor).toBe(episode!.lastWriteAt);
	});

	it('carries an item whose episode ended since, without the episode', async () => {
		const n = await item();
		await startItem(projectId, n, AGENT);
		await recordWorkerActivity(projectId, n, AGENT);
		await settle();
		const { cursor } = await getProjectMap(projectId);

		await sql('SET session_replication_role = replica');
		await sql('UPDATE item_workers SET ended_at = now() WHERE project_id = $1', [projectId]);
		await sql('SET session_replication_role = DEFAULT');

		const delta = await getProjectMap(projectId, cursor);
		expect(delta.items.map((r) => r.key)).toEqual([`MP-${n}`]);
		expect(delta.items[0]!.workers).toEqual([]);
	});

	it('carries what waits on a blocker that finished, whose links and blocked flag moved with it', async () => {
		const blocker = await item();
		const waiting = await item();
		await addBlocker(projectId, waiting, { itemNumber: blocker }, USER);
		await settle();
		const { cursor } = await getProjectMap(projectId);

		await completeItem(projectId, blocker, USER);

		const delta = await getProjectMap(projectId, cursor);
		expect(delta.items.map((r) => r.key)).toEqual([`MP-${blocker}`, `MP-${waiting}`]);
		expect(delta.items[1]).toMatchObject({ blocked: false, blockers: [{ blockerKey: `MP-${blocker}`, state: 'satisfied' }] });
	});

	it('counts the project, so a deletion shows, and fingerprints spec links, which updated_at misses', async () => {
		const kept = await item();
		const gone = await item();
		await settle();
		const first = await getProjectMap(projectId);
		expect(first.total).toBe(2);

		await sql('DELETE FROM items WHERE project_id = $1 AND number = $2', [projectId, gone]);
		const afterDelete = await getProjectMap(projectId, first.cursor);
		expect(afterDelete.total).toBe(1);
		expect(afterDelete.items).toEqual([]);

		await addSpec(projectId, kept, 'docs/specs/map.md', 'product');
		const afterSpec = await getProjectMap(projectId, afterDelete.cursor);
		expect(afterSpec.specs).not.toBe(afterDelete.specs);
		expect(afterSpec.specs.startsWith('1:')).toBe(true);
	});

	it('past the read cap stays empty while idle, and answers a change with the whole read', async () => {
		const parent = await item({ type: 'epic' });
		for (let i = 0; i < 3; i++) await item({ parentNumber: parent, status: 'done' });
		await completeItem(projectId, parent, USER);
		const loose = await item();
		await settle();
		const first = await getProjectMap(projectId, null, 2);
		expect(first.summarized).toBe(true);

		const idle = await getProjectMap(projectId, first.cursor, 2);
		expect(idle).toMatchObject({ delta: true, items: [], total: 5 });

		await updateItem(projectId, loose, { title: 'renamed' }, USER);
		const changed = await getProjectMap(projectId, first.cursor, 2);
		expect(changed).toMatchObject({ delta: false, summarized: true });
		expect(changed.items.map((r) => r.key)).toEqual(first.items.map((r) => r.key));
	});
});

describe('session keys', () => {
	it('depend on every part of the identity', () => {
		const base = agentSessionKey(AGENT);
		expect(agentSessionKey({ ...AGENT })).toBe(base);
		expect(agentSessionKey({ ...AGENT, userId: 'someone-else' })).not.toBe(base);
		expect(agentSessionKey({ ...AGENT, clientId: 'another-client' })).not.toBe(base);
		expect(agentSessionKey({ ...AGENT, sessionId: undefined })).not.toBe(base);
	});

	it('cannot be made to collide by moving characters between the parts', () => {
		const split = (clientId: string, sessionId: string): string =>
			agentSessionKey({ userId: 'u', clientId, sessionId });
		expect(split('ab', 'c')).not.toBe(split('a', 'bc'));
		expect(split('a","b', 'c')).not.toBe(split('a', 'b","c'));
	});
});

describe('the payload', () => {
	it('fits 2,000 items in the budget, gzipped', async () => {
		const { identifiers } = await generateMapProject(
			(text, params) => state.db!.query(text, params),
			{ projectId, userId, items: 2000, now: Date.now() },
		);

		const map = await getProjectMap(projectId);
		const json = JSON.stringify(encodeMapRead(map, 'MP'));
		const gzipped = gzipSync(json).length;

		expect(map.items).toHaveLength(2000);
		expect(map.summarized).toBe(false);
		expect(map.items.some((r) => r.workers.length > 0)).toBe(true);
		expect(map.items.some((r) => r.blockers.some((b) => b.state === 'satisfied'))).toBe(true);
		expect(map.items.some((r) => r.status === 'done' && r.completedAt === null)).toBe(true);
		for (const id of identifiers) expect(json).not.toContain(id);
		console.log(`map payload, 2,000 items: ${json.length} bytes, ${gzipped} gzipped`);
		expect(gzipped).toBeLessThan(100 * 1024);
	}, 60_000);

	it('keeps a poll small: an idle one, and one with a few changed items', async () => {
		await generateMapProject((text, params) => state.db!.query(text, params), { projectId, userId, items: 2000, now: Date.now() });
		await settle();
		const { cursor } = await getProjectMap(projectId);
		const size = (read: Awaited<ReturnType<typeof getProjectMap>>): { raw: number; gzipped: number } => {
			const json = JSON.stringify(encodeMapRead(read, 'MP'));
			return { raw: json.length, gzipped: gzipSync(json).length };
		};

		const idle = size(await getProjectMap(projectId, cursor));
		for (const n of [5, 600, 1400]) await updateItem(projectId, n, { status: 'in_progress' }, AGENT);
		await recordWorkerActivity(projectId, 600, AGENT);
		const changed = await getProjectMap(projectId, cursor);
		const few = size(changed);

		console.log(`map poll, 2,000 items: idle ${idle.raw} bytes (${idle.gzipped} gzipped), ${changed.items.length} changed ${few.raw} bytes (${few.gzipped} gzipped)`);
		expect(idle.raw).toBeLessThan(1024);
		expect(few.gzipped).toBeLessThan(2048);
	}, 60_000);
});

describe('past the read cap', () => {
	const base = (key: string, fields: Partial<MapItemRow> = {}): MapItemRow => ({
		key, type: 'task', title: key, status: 'done', subStatus: 'complete', blocked: false, parentKey: null, rank: 1,
		createdAt: '2026-01-01T00:00:00.000Z', startedAt: null, completedAt: null, timeAnchor: '2026-01-01T00:00:00.000Z',
		workers: [], blockers: [], textBlockerCount: 0, discoveredFromKey: null, originActorType: 'user', prUrl: null,
		specCount: 0, ...fields,
	});
	const at = (day: number): string => `2026-02-${String(day).padStart(2, '0')}T00:00:00.000Z`;

	/** An old finished epic (MP-1, three deep), a newer one (MP-5), and a live epic holding a finished sub-epic. */
	const board = (): MapItemRow[] => [
		base('MP-1', { type: 'epic', timeAnchor: at(1) }),
		base('MP-2', { parentKey: 'MP-1', timeAnchor: at(2) }),
		base('MP-3', { type: 'epic', parentKey: 'MP-1', timeAnchor: at(3) }),
		base('MP-4', { parentKey: 'MP-3', timeAnchor: at(4) }),
		base('MP-5', { type: 'epic', timeAnchor: at(10) }),
		base('MP-6', { parentKey: 'MP-5', timeAnchor: at(11) }),
		base('MP-7', { type: 'epic', status: 'in_progress', subStatus: 'in_development', timeAnchor: at(20) }),
		base('MP-8', { type: 'epic', parentKey: 'MP-7', timeAnchor: at(12) }),
		base('MP-9', { parentKey: 'MP-8', timeAnchor: at(13) }),
		base('MP-10', { parentKey: 'MP-7', status: 'ready', subStatus: 'not_started', timeAnchor: at(21),
			blockers: [{ blockerKey: 'MP-4', state: 'satisfied', satisfiedAt: at(4) }], discoveredFromKey: 'MP-2' }),
	];

	it('returns everything untouched within the cap', () => {
		expect(summarizeFinishedFamilies(board(), 10)).toEqual({ items: board(), summarized: false });
	});

	it('folds the oldest finished family first, into one row with its count and newest anchor', () => {
		const { items, summarized } = summarizeFinishedFamilies(board(), 9);

		expect(summarized).toBe(true);
		expect(items.map((r) => r.key)).toEqual(['MP-1', 'MP-5', 'MP-6', 'MP-7', 'MP-8', 'MP-9', 'MP-10']);
		expect(items[0]).toMatchObject({ key: 'MP-1', summarizedDescendants: 3, timeAnchor: at(4) });
		// What named a folded item now names the row that holds it.
		expect(items.at(-1)).toMatchObject({ blockers: [{ blockerKey: 'MP-1', state: 'satisfied', satisfiedAt: at(4) }], discoveredFromKey: 'MP-1' });
	});

	it('folds a finished family under live work, and never the live work itself', () => {
		const { items } = summarizeFinishedFamilies(board(), 1);

		expect(items.map((r) => r.key)).toEqual(['MP-1', 'MP-5', 'MP-7', 'MP-8', 'MP-10']);
		expect(items.find((r) => r.key === 'MP-8')).toMatchObject({ summarizedDescendants: 1, parentKey: 'MP-7' });
		expect(items.find((r) => r.key === 'MP-7')!.summarizedDescendants).toBeUndefined();
	});

	it('folds a family nested deeper than the call stack would allow', () => {
		const depth = 50_000;
		const rows = Array.from({ length: depth }, (_, i) =>
			base(`MP-${i + 1}`, { parentKey: i ? `MP-${i}` : null, timeAnchor: at(1 + (i % 20)) }));

		const { items } = summarizeFinishedFamilies(rows, 1);

		expect(items).toEqual([expect.objectContaining({ key: 'MP-1', summarizedDescendants: depth - 1, timeAnchor: at(20) })]);
	});

	it('gives a folded row its members\' links, minus any inside the family', () => {
		const rows = board();
		rows[1] = { ...rows[1]!, blockers: [{ blockerKey: 'MP-6', state: 'satisfied', satisfiedAt: at(9) }] };
		rows[3] = { ...rows[3]!, blockers: [{ blockerKey: 'MP-2', state: 'satisfied', satisfiedAt: at(3) }] };

		const { items } = summarizeFinishedFamilies(rows, 9);

		expect(items[0]!.blockers).toEqual([{ blockerKey: 'MP-6', state: 'satisfied', satisfiedAt: at(9) }]);
	});
});
