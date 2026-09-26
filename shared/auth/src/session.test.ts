/**
 * Session read/update tests
 */

import { describe, it, expect } from 'vitest';
import type { Redis } from 'ioredis';

import { deleteUserSessions, getSession, updateSession } from './session.ts';
import { SESSION_TTL_SECONDS } from './types.ts';

interface FakeRedis {
	redis: Redis;
	store: Map<string, string>;
	/** Every write, in order, as `command key [ttl]` */
	writes: string[];
}

// Pages the scan two keys at a time so the cursor loop is exercised, over a
// snapshot taken when the scan starts: like Redis SCAN, deleting keys mid-scan
// doesn't skip the rest. eval stands in for the merge script (a real Redis
// would run the Lua): it merges the JSON updates into the stored session and
// sets it with the given TTL.
function fakeRedis(entries: Record<string, string>): FakeRedis {
	const store = new Map(Object.entries(entries));
	const writes: string[] = [];
	let keys: string[] = [];
	const redis = {
		scan: async (cursor: string, _match: 'MATCH', pattern: string) => {
			if (cursor === '0') {
				const prefix = pattern.replace(/\*$/, '');
				keys = [...store.keys()].filter((key) => key.startsWith(prefix));
			}
			const start = Number(cursor);
			const next = start + 2 >= keys.length ? '0' : String(start + 2);
			return [next, keys.slice(start, start + 2)];
		},
		get: async (key: string) => store.get(key) ?? null,
		expire: async (key: string, seconds: number) => {
			writes.push(`expire ${key} ${seconds}`);
			return store.has(key) ? 1 : 0;
		},
		eval: async (_script: string, _numKeys: number, key: string, updates: string, ttl: number) => {
			const raw = store.get(key);
			if (raw === undefined) return 0;
			store.set(key, JSON.stringify({ ...JSON.parse(raw), ...JSON.parse(updates) }));
			writes.push(`set ${key} ${ttl}`);
			return 1;
		},
		del: async (key: string) => {
			writes.push(`del ${key}`);
			return store.delete(key) ? 1 : 0;
		},
	} as unknown as Redis;
	return { redis, store, writes };
}

function session(userId: string, extra: Record<string, unknown> = {}): string {
	return JSON.stringify({ userId, csrfToken: 't', createdAt: 1, ...extra });
}

const ENTRIES = {
	'session:a1': session('alice'),
	'session:b1': session('bob'),
	'session:a2': session('alice', { profileComplete: true }),
	'session:bad': '{not json',
	'rate:alice': session('alice'),
};

describe('getSession', () => {
	it('slides the expiry without rewriting the session body', async () => {
		const { redis, store, writes } = fakeRedis(ENTRIES);

		const found = await getSession(redis, 'a1');

		expect(found).toEqual(JSON.parse(ENTRIES['session:a1']));
		expect(store.get('session:a1')).toBe(ENTRIES['session:a1']);
		expect(writes).toEqual([`expire session:a1 ${SESSION_TTL_SECONDS}`]);
	});

	it('returns null for a missing session without writing', async () => {
		const { redis, writes } = fakeRedis(ENTRIES);

		expect(await getSession(redis, 'gone')).toBeNull();
		expect(writes).toEqual([]);
	});

	it('deletes corrupted session data', async () => {
		const { redis, store } = fakeRedis(ENTRIES);

		expect(await getSession(redis, 'bad')).toBeNull();
		expect(store.has('session:bad')).toBe(false);
	});
});

describe('updateSession', () => {
	it('merges the updates and refreshes the TTL', async () => {
		const { redis, store, writes } = fakeRedis(ENTRIES);

		expect(await updateSession(redis, 'a1', { profileComplete: true })).toBe(true);

		expect(JSON.parse(store.get('session:a1')!)).toEqual({
			...JSON.parse(ENTRIES['session:a1']),
			profileComplete: true,
		});
		expect(writes).toEqual([`set session:a1 ${SESSION_TTL_SECONDS}`]);
	});

	it('returns false and writes nothing when the session is gone', async () => {
		const { redis, store, writes } = fakeRedis(ENTRIES);

		expect(await updateSession(redis, 'gone', { profileComplete: true })).toBe(false);
		expect(store.has('session:gone')).toBe(false);
		expect(writes).toEqual([]);
	});
});

describe('deleteUserSessions', () => {
	it('deletes every session of the user and only theirs', async () => {
		const { redis, store } = fakeRedis(ENTRIES);

		await deleteUserSessions(redis, 'alice');

		expect([...store.keys()].sort()).toEqual(['rate:alice', 'session:b1', 'session:bad']);
	});
});
