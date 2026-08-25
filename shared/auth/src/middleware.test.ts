/**
 * Auth middleware tests
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';

import { authMiddleware, type AuthVariables } from './middleware.ts';
import { SESSION_COOKIE_NAME } from './types.ts';

const SESSION_JSON = JSON.stringify({
	userId: 'user-1',
	csrfToken: 'token',
	createdAt: Date.now(),
	lastAccessedAt: Date.now(),
});

function appWith(redis: Redis): Hono<{ Variables: AuthVariables }> {
	const app = new Hono<{ Variables: AuthVariables }>();
	app.use('*', authMiddleware(redis));
	app.get('/api/items', (c) => c.json({ userId: c.get('user').id }));
	app.onError((_error, c) => c.json({ error: 'Internal server error' }, 500));
	return app;
}

function get(app: Hono<{ Variables: AuthVariables }>): Promise<Response> {
	return Promise.resolve(
		app.request('/api/items', {
			headers: { Cookie: `${SESSION_COOKIE_NAME}=abc123` },
		})
	);
}

describe('auth middleware', () => {
	it('attaches the user for a valid session', async () => {
		const redis = {
			get: async () => SESSION_JSON,
			setex: async () => 'OK',
		} as unknown as Redis;

		const res = await get(appWith(redis));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ userId: 'user-1' });
	});

	it('rejects an unknown session with 401', async () => {
		const redis = {
			get: async () => null,
		} as unknown as Redis;

		const res = await get(appWith(redis));
		expect(res.status).toBe(401);
	});

	it('takes the unauthenticated path, not a 500, when Redis rejects', async () => {
		const redis = {
			get: () => Promise.reject(new Error('Reached the max retries per request limit')),
		} as unknown as Redis;

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const res = await get(appWith(redis));
			expect(res.status).toBe(401);
			expect(errorSpy).toHaveBeenCalled();
		} finally {
			errorSpy.mockRestore();
		}
	});
});
