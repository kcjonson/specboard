/**
 * Fresh admin check against the API
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { sessionIsAdmin } from './admin-check.ts';

const API_URL = 'http://api.test';

function mockFetch(respond: (init: RequestInit) => Promise<Response>): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn((_url: string, init: RequestInit) => respond(init));
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function json(body: unknown, status = 200): Promise<Response> {
	return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('sessionIsAdmin', () => {
	it('asks /api/auth/me with only the session cookie and allows an admin', async () => {
		const fetchMock = mockFetch(() => json({ user: { id: 'u1', roles: ['admin'] } }));

		expect(await sessionIsAdmin(API_URL, 'abc123')).toBe(true);
		expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${API_URL}/api/auth/me`, expect.objectContaining({
			headers: { Cookie: 'session_id=abc123' },
			signal: expect.any(AbortSignal),
		}));
	});

	it('denies a user without the admin role', async () => {
		mockFetch(() => json({ user: { id: 'u1', roles: [] } }));

		expect(await sessionIsAdmin(API_URL, 'abc123')).toBe(false);
	});

	it.each([401, 403, 429, 500, 503])('denies on a %s', async (status) => {
		mockFetch(() => json({ user: { id: 'u1', roles: ['admin'] } }, status));

		expect(await sessionIsAdmin(API_URL, 'abc123')).toBe(false);
	});

	it.each([
		['no user', {}],
		['no roles', { user: { id: 'u1' } }],
		['roles that are not an array', { user: { roles: 'admin' } }],
		['null', null],
	])('denies a 200 with %s', async (_label, body) => {
		mockFetch(() => json(body));

		expect(await sessionIsAdmin(API_URL, 'abc123')).toBe(false);
	});

	it('rejects on a body that is not JSON', async () => {
		mockFetch(() => Promise.resolve(new Response('<html>', { status: 200 })));

		await expect(sessionIsAdmin(API_URL, 'abc123')).rejects.toThrow();
	});

	it('rejects when the API is unreachable', async () => {
		mockFetch(() => Promise.reject(new TypeError('fetch failed')));

		await expect(sessionIsAdmin(API_URL, 'abc123')).rejects.toThrow('fetch failed');
	});

	it('rejects when the request times out', async () => {
		const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(
			AbortSignal.abort(new Error('The operation was aborted due to timeout'))
		);
		mockFetch((init) => {
			init.signal?.throwIfAborted();
			return json({ user: { roles: ['admin'] } });
		});

		await expect(sessionIsAdmin(API_URL, 'abc123')).rejects.toThrow('timeout');
		expect(timeout).toHaveBeenCalledWith(5000);
	});
});
