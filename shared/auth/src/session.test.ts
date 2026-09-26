/**
 * Per-user session maintenance tests
 */

import { describe, it, expect } from 'vitest';
import type { Redis } from 'ioredis';

import { deleteUserSessions, updateUserSessions } from './session.ts';

interface FakeRedis {
	redis: Redis;
	store: Map<string, string>;
	ttlWrites: string[];
}

// Pages the scan two keys at a time so the cursor loop is exercised
function fakeRedis(entries: Record<string, string>): FakeRedis {
	const store = new Map(Object.entries(entries));
	const ttlWrites: string[] = [];
	const redis = {
		scan: async (cursor: string, _match: 'MATCH', pattern: string) => {
			const prefix = pattern.replace(/\*$/, '');
			const keys = [...store.keys()].filter((key) => key.startsWith(prefix));
			const start = Number(cursor);
			const next = start + 2 >= keys.length ? '0' : String(start + 2);
			return [next, keys.slice(start, start + 2)];
		},
		get: async (key: string) => store.get(key) ?? null,
		set: async (key: string, value: string, mode: string) => {
			if (mode !== 'KEEPTTL') ttlWrites.push(key);
			store.set(key, value);
			return 'OK';
		},
		del: async (key: string) => (store.delete(key) ? 1 : 0),
	} as unknown as Redis;
	return { redis, store, ttlWrites };
}

function session(userId: string, extra: Record<string, unknown> = {}): string {
	return JSON.stringify({ userId, csrfToken: 't', createdAt: 1, lastAccessedAt: 1, ...extra });
}

const ENTRIES = {
	'session:a1': session('alice', { isAdmin: false }),
	'session:b1': session('bob'),
	'session:a2': session('alice', { isAdmin: false, profileComplete: true }),
	'session:bad': '{not json',
	'rate:alice': session('alice'),
};

describe('updateUserSessions', () => {
	it('updates every session of the user and only theirs, keeping the TTL', async () => {
		const { redis, store, ttlWrites } = fakeRedis(ENTRIES);

		await updateUserSessions(redis, 'alice', { isAdmin: true });

		expect(JSON.parse(store.get('session:a1')!)).toMatchObject({ userId: 'alice', isAdmin: true });
		expect(JSON.parse(store.get('session:a2')!)).toMatchObject({ isAdmin: true, profileComplete: true });
		expect(store.get('session:b1')).toBe(ENTRIES['session:b1']);
		expect(store.get('session:bad')).toBe('{not json');
		expect(store.get('rate:alice')).toBe(ENTRIES['rate:alice']);
		expect(ttlWrites).toEqual([]);
	});
});

describe('deleteUserSessions', () => {
	it('deletes every session of the user and only theirs', async () => {
		const { redis, store } = fakeRedis(ENTRIES);

		await deleteUserSessions(redis, 'alice');

		expect([...store.keys()].sort()).toEqual(['rate:alice', 'session:b1', 'session:bad']);
	});
});
