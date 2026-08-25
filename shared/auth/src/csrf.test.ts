/**
 * CSRF middleware tests
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';

import { csrfMiddleware, CSRF_HEADER_NAME } from './csrf.ts';
import { SESSION_COOKIE_NAME } from './types.ts';

const SESSION_JSON = JSON.stringify({
	userId: 'user-1',
	csrfToken: 'valid-token',
	createdAt: Date.now(),
	lastAccessedAt: Date.now(),
});

function appWith(redis: Redis): Hono {
	const app = new Hono();
	app.use('*', csrfMiddleware(redis));
	app.post('/api/items', (c) => c.json({ ok: true }));
	app.onError((_error, c) => c.json({ error: 'Internal server error' }, 500));
	return app;
}

function post(app: Hono, token?: string): Promise<Response> {
	const headers: Record<string, string> = {
		Cookie: `${SESSION_COOKIE_NAME}=abc123`,
	};
	if (token) {
		headers[CSRF_HEADER_NAME] = token;
	}
	return Promise.resolve(app.request('/api/items', { method: 'POST', headers }));
}

describe('csrf middleware', () => {
	it('allows a request with a valid token', async () => {
		const redis = {
			get: async () => SESSION_JSON,
			setex: async () => 'OK',
		} as unknown as Redis;

		const res = await post(appWith(redis), 'valid-token');
		expect(res.status).toBe(200);
	});

	it('rejects an invalid token with 403', async () => {
		const redis = {
			get: async () => SESSION_JSON,
			setex: async () => 'OK',
		} as unknown as Redis;

		const res = await post(appWith(redis), 'wrong-token');
		expect(res.status).toBe(403);
	});

	it('returns 403, not 500, when Redis rejects the session lookup', async () => {
		const redis = {
			get: () => Promise.reject(new Error('Reached the max retries per request limit')),
		} as unknown as Redis;

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const res = await post(appWith(redis), 'valid-token');
			expect(res.status).toBe(403);
			expect(errorSpy).toHaveBeenCalled();
		} finally {
			errorSpy.mockRestore();
		}
	});
});
