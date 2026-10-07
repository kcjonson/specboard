/**
 * Connecting GitHub from somewhere other than Settings: the OAuth start takes a `next`
 * path, the callback lands there, and a new connection drops the push-access answers
 * the previous token earned.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';

vi.mock('@specboard/auth', () => ({
	getSession: vi.fn(async () => ({ userId: 'user-1', csrfToken: 'csrf', createdAt: Date.now() })),
	SESSION_COOKIE_NAME: 'session',
	encrypt: vi.fn(() => ({ iv: 'iv', data: 'data', tag: 'tag' })),
	decrypt: vi.fn(),
}));

vi.mock('@specboard/db', () => ({
	query: vi.fn(async () => ({ rows: [] })),
}));

vi.mock('../services/push-access.ts', () => ({
	forgetPushAccess: vi.fn(async () => undefined),
	warmPushAccess: vi.fn(async () => undefined),
}));

import { forgetPushAccess, warmPushAccess } from '../services/push-access.ts';
import { handleGitHubAuthCallback, handleGitHubAuthStart } from './github.ts';

function fakeRedis(): Redis & { store: Map<string, string> } {
	const store = new Map<string, string>();
	return {
		store,
		get: vi.fn(async (key: string) => store.get(key) ?? null),
		setex: vi.fn(async (key: string, _ttl: number, value: string) => {
			store.set(key, value);
			return 'OK';
		}),
		del: vi.fn(async (...keys: string[]) => keys.filter((key) => store.delete(key)).length),
	} as unknown as Redis & { store: Map<string, string> };
}

let redis: ReturnType<typeof fakeRedis>;

function app(): Hono {
	const hono = new Hono();
	hono.get('/api/auth/github', (context) => handleGitHubAuthStart(context, redis));
	hono.get('/api/auth/github/callback', (context) => handleGitHubAuthCallback(context, redis));
	return hono;
}

async function start(query: string): Promise<string> {
	const response = await app().request(`http://localhost/api/auth/github${query}`, { headers: { Cookie: 'session=sess-1' } });
	expect(response.status).toBe(302);
	return new URL(response.headers.get('Location')!).searchParams.get('state')!;
}

beforeEach(() => {
	vi.clearAllMocks();
	redis = fakeRedis();
	vi.stubEnv('GITHUB_CLIENT_ID', 'client-id');
	vi.stubEnv('GITHUB_CLIENT_SECRET', 'client-secret');
	vi.stubGlobal('fetch', vi.fn(async (url: string) => {
		if (url.includes('/login/oauth/access_token')) {
			return new Response(JSON.stringify({ access_token: 'gho_new', token_type: 'bearer', scope: 'repo user:email' }));
		}
		return new Response(JSON.stringify({ id: 42, login: 'vera' }));
	}));
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('GitHub connect return path', () => {
	it('lands on the page it was started from', async () => {
		const state = await start('?next=%2Fprojects%2Facme%2Froadmap%2Fplanning');

		const response = await app().request(`http://localhost/api/auth/github/callback?code=abc&state=${state}`);

		expect(response.status).toBe(302);
		expect(response.headers.get('Location')).toBe('/projects/acme/roadmap/planning');
		expect(redis.store.size).toBe(0);
	});

	it('lands on Settings without one', async () => {
		const state = await start('');

		const response = await app().request(`http://localhost/api/auth/github/callback?code=abc&state=${state}`);

		expect(response.headers.get('Location')).toBe('/settings?github_connected=true');
	});

	it.each([
		['another origin', 'https://evil.example/projects'],
		['a protocol-relative URL', '//evil.example/projects'],
		['a backslash path', '/\\evil.example'],
	])('ignores %s', async (_what, next) => {
		const state = await start(`?next=${encodeURIComponent(next)}`);

		const response = await app().request(`http://localhost/api/auth/github/callback?code=abc&state=${state}`);

		expect(response.headers.get('Location')).toBe('/settings?github_connected=true');
	});

	it('forgets the old token\'s push-access answers and checks again', async () => {
		const state = await start('');

		await app().request(`http://localhost/api/auth/github/callback?code=abc&state=${state}`);

		expect(forgetPushAccess).toHaveBeenCalledWith(redis, 'user-1');
		expect(warmPushAccess).toHaveBeenCalledWith(redis, 'user-1');
	});
});
