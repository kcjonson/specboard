/**
 * The planning routes as production mounts them: the Map read sits behind the same
 * access gate as the items list, so a stranger gets the same answer from both, and the
 * read goes out gzipped in its column form.
 */

import { gunzipSync } from 'node:zlib';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import type { MapRead, MapReadWire } from '@specboard/core/map-read';
import type { MapChangesWire } from '@specboard/core/map-changes';

vi.mock('@specboard/auth', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/auth')>()),
	getSession: vi.fn(),
}));

vi.mock('@specboard/db', async (importOriginal) => ({
	...(await importOriginal<typeof import('@specboard/db')>()),
	resolveProjectAccess: vi.fn(),
	getItems: vi.fn(),
	getProjectMap: vi.fn(),
	getMapChanges: vi.fn(),
	advanceMapBaseline: vi.fn(),
}));

import { getSession, SESSION_COOKIE_NAME } from '@specboard/auth';
import { advanceMapBaseline, getItems, getMapChanges, getProjectMap, resolveProjectAccess } from '@specboard/db';
import { registerPlanningRoutes } from './planning-routes.ts';
import type { AppVariables } from './project-access.ts';

const OWNER = 'owner-1';
const STRANGER = 'stranger-2';
const PROJECT = { id: 'proj-1', slug: 'roadmap', ownerSlug: 'acme', key: 'SB' };

function app(): Hono<{ Variables: AppVariables }> {
	const mounted = new Hono<{ Variables: AppVariables }>();
	registerPlanningRoutes(mounted, { redis: {} as Redis });
	return mounted;
}

async function get(path: string, session: string | null, headers: Record<string, string> = {}): Promise<Response> {
	return app().request(`http://localhost/api/projects/acme/roadmap/${path}`, {
		headers: { ...(session ? { cookie: `${SESSION_COOKIE_NAME}=${session}` } : {}), ...headers },
	});
}

async function post(path: string, session: string | null, body: unknown): Promise<Response> {
	return app().request(`http://localhost/api/projects/acme/roadmap/${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...(session ? { cookie: `${SESSION_COOKIE_NAME}=${session}` } : {}) },
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});
}

const row = (n: number): MapRead['items'][number] => ({
	key: `SB-${n}`, type: 'task', title: `Task number ${n} with a title long enough to matter`, status: 'ready',
	subStatus: 'not_started', blocked: false, parentKey: null, rank: n, createdAt: '2026-09-01T00:00:00.000Z',
	startedAt: null, completedAt: null, timeAnchor: '2026-09-01T00:00:00.000Z', workers: [], blockers: [],
	textBlockerCount: 0, discoveredFromKey: null, originActorType: 'agent', prUrl: null, specCount: 0,
});

beforeEach(() => {
	vi.mocked(getSession).mockReset();
	vi.mocked(getSession).mockImplementation(async (_redis, id) => (id === 'none' ? null : { userId: id } as never));
	vi.mocked(resolveProjectAccess).mockReset();
	vi.mocked(resolveProjectAccess).mockImplementation(async (_owner, _project, userId) =>
		userId === OWNER ? { project: PROJECT, grantedRole: 'owner', effectiveRole: 'owner' } : null);
	vi.mocked(getItems).mockReset();
	vi.mocked(getItems).mockResolvedValue({ items: [], total: 0 });
	vi.mocked(getProjectMap).mockReset();
	vi.mocked(getProjectMap).mockResolvedValue({
		items: Array.from({ length: 40 }, (_, i) => row(i + 1)), summarized: false, delta: false, cursor: 1_790_000_000_000, total: 40, specs: '0:',
	});
	vi.mocked(getMapChanges).mockReset();
	vi.mocked(getMapChanges).mockResolvedValue({
		baseline: 1_790_000_000_000,
		readAt: 1_790_100_000_000,
		changes: [{ key: 'SB-3', kind: 'finished', at: 1_790_050_000_000 }, { key: 'SB-9', kind: 'filed', at: 1_790_060_000_000 }],
	});
	vi.mocked(advanceMapBaseline).mockReset();
	vi.mocked(advanceMapBaseline).mockResolvedValue(1_790_100_000_000);
});

describe('GET /map access', () => {
	it.each([
		['someone who is not the owner', STRANGER],
		['an expired session', 'none'],
		['no session at all', null],
	])('answers %s exactly as the items list does', async (_who, session) => {
		const items = await get('items', session);
		const map = await get('map', session);

		expect(map.status).toBe(items.status);
		expect(await map.json()).toEqual(await items.json());
		expect([401, 404]).toContain(map.status);
		expect(getProjectMap).not.toHaveBeenCalled();
	});

	it('reads the resolved project for its owner', async () => {
		const response = await get('map', OWNER);

		expect(response.status).toBe(200);
		expect(getProjectMap).toHaveBeenCalledWith('proj-1', null);
		const wire = await response.json() as MapReadWire;
		expect(wire).toMatchObject({ projectKey: 'SB', summarized: false, delta: false, cursor: 1_790_000_000_000, total: 40 });
		expect(wire.number).toHaveLength(40);
	});

	it('reads only what changed after the cursor an earlier read gave', async () => {
		vi.mocked(getProjectMap).mockResolvedValue({ items: [row(7)], summarized: false, delta: true, cursor: 1_790_000_010_000, total: 40, specs: '0:' });

		const response = await get('map?since=1790000000000', OWNER);

		expect(response.status).toBe(200);
		expect(getProjectMap).toHaveBeenCalledWith('proj-1', 1_790_000_000_000);
		expect(await response.json()).toMatchObject({ delta: true, number: [7], cursor: 1_790_000_010_000 });
	});

	it.each(['', 'soon', '-5', '1.5', '1e12', '99999999999999999999'])('refuses since=%s, which no read gave', async (since) => {
		const response = await get(`map?since=${since}`, OWNER);

		expect(response.status).toBe(400);
		expect(getProjectMap).not.toHaveBeenCalled();
	});
});

describe('GET /map encoding', () => {
	it('gzips the response for a client that accepts it', async () => {
		const response = await get('map', OWNER, { 'accept-encoding': 'gzip' });

		expect(response.headers.get('content-encoding')).toBe('gzip');
		const wire = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()) as MapReadWire;
		expect(wire.title[0]).toBe('Task number 1 with a title long enough to matter');
	});

	it('answers a read failure with a 500 and no detail', async () => {
		vi.mocked(getProjectMap).mockRejectedValue(new Error('connection reset by peer at 10.0.0.4'));
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const response = await get('map', OWNER);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: 'Database error' });
	});
});

describe('the last-visit baseline routes', () => {
	it.each([
		['someone who is not the owner', STRANGER],
		['an expired session', 'none'],
		['no session at all', null],
	])('answer %s as the Map read does', async (_who, session) => {
		const map = await get('map', session);
		const changes = await get('map/changes', session);
		const seen = await post('map/seen', session, { readAt: 1_790_100_000_000 });

		expect(changes.status).toBe(map.status);
		expect(seen.status).toBe(map.status);
		expect(await changes.json()).toEqual(await map.json());
		expect([401, 404]).toContain(changes.status);
		expect(getMapChanges).not.toHaveBeenCalled();
		expect(advanceMapBaseline).not.toHaveBeenCalled();
	});

	it('reads the changes for the signed-in owner, in columns', async () => {
		const response = await get('map/changes', OWNER);

		expect(response.status).toBe(200);
		expect(getMapChanges).toHaveBeenCalledWith(OWNER, 'proj-1', 'SB');
		expect(await response.json() as MapChangesWire).toEqual({
			projectKey: 'SB', baseline: 1_790_000_000_000, readAt: 1_790_100_000_000,
			number: [3, 9], kind: ['finished', 'filed'], at: [1_790_050_000_000, 1_790_060_000_000],
		});
	});

	it('moves the baseline for the signed-in person, to the read time they send', async () => {
		const response = await post('map/seen', OWNER, { readAt: 1_790_100_000_000 });

		expect(response.status).toBe(200);
		expect(advanceMapBaseline).toHaveBeenCalledWith(OWNER, 'proj-1', 1_790_100_000_000);
		expect(await response.json()).toEqual({ baseline: 1_790_100_000_000 });
	});

	it.each([
		['not JSON', 'readAt=1'],
		['no read time', {}],
		['a null body', 'null'],
		['a string for the read time', { readAt: '2026-10-03' }],
		['a non-positive read time', { readAt: 0 }],
	])('refuses %s', async (_what, body) => {
		const response = await post('map/seen', OWNER, body);

		expect(response.status).toBe(400);
		expect(advanceMapBaseline).not.toHaveBeenCalled();
	});

	it('answers a failure with a 500 and no detail', async () => {
		vi.mocked(advanceMapBaseline).mockRejectedValue(new Error('deadlock detected at 10.0.0.4'));
		vi.mocked(getMapChanges).mockRejectedValue(new Error('connection reset'));
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const seen = await post('map/seen', OWNER, { readAt: 1_790_100_000_000 });
		const changes = await get('map/changes', OWNER);

		expect(seen.status).toBe(500);
		expect(await seen.json()).toEqual({ error: 'Database error' });
		expect(changes.status).toBe(500);
	});
});
