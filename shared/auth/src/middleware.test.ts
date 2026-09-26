/**
 * Auth middleware tests
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';

import { authMiddleware, requireAdminSession, type AuthVariables } from './middleware.ts';
import { SESSION_COOKIE_NAME } from './types.ts';

const SESSION_JSON = JSON.stringify({
	userId: 'user-1',
	csrfToken: 'token',
	createdAt: Date.now(),
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
			expire: async () => 1,
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

describe('requireAdminSession', () => {
	function sessionRedis(fields: Record<string, unknown>): Redis {
		const json = JSON.stringify({ ...JSON.parse(SESSION_JSON), ...fields });
		return {
			get: async () => json,
			expire: async () => 1,
		} as unknown as Redis;
	}

	function adminApp(redis: Redis): Hono<{ Variables: AuthVariables }> {
		const app = new Hono<{ Variables: AuthVariables }>();
		app.use('*', authMiddleware(redis));
		app.use('*', requireAdminSession({
			prefix: '/admin',
			onDenied: () => new Response('not found', { status: 404 }),
		}));
		app.get('*', (c) => c.text('spa'));
		return app;
	}

	function load(app: Hono<{ Variables: AuthVariables }>, path: string): Promise<Response> {
		return Promise.resolve(
			app.request(path, {
				headers: { Cookie: `${SESSION_COOKIE_NAME}=abc123` },
			})
		);
	}

	const adminPaths = ['/admin', '/admin/', '/admin/ui', '/admin/users/some-id', '//admin/ui', '/admin//ui', '/x/%2e%2e/admin/ui'];

	it.each(adminPaths)('serves %s to an admin session', async (path) => {
		const res = await load(adminApp(sessionRedis({ isAdmin: true })), path);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('spa');
	});

	it.each(adminPaths)('denies %s to a non-admin session', async (path) => {
		const res = await load(adminApp(sessionRedis({ isAdmin: false })), path);
		expect(res.status).toBe(404);
	});

	// Hono percent-decodes c.req.path before the gate compares it, and a
	// malformed escape later in the path doesn't stop the prefix decoding.
	// Encodings Hono keeps (%25, %2F) never render an admin page in the SPA
	// router either; shared/router start-router.test.tsx pins that half.
	it.each(['/%61dmin/ui', '/%61%64%6D%69%6E', '/%61dmin/%E0%A4%A'])('denies the encoded %s to a non-admin session', async (path) => {
		const res = await load(adminApp(sessionRedis({ isAdmin: false })), path);
		expect(res.status).toBe(404);
	});

	it('denies a session created before the flag existed', async () => {
		const res = await load(adminApp(sessionRedis({})), '/admin/ui');
		expect(res.status).toBe(404);
	});

	it('denies a request that reached the gate without a session', async () => {
		const app = new Hono<{ Variables: AuthVariables }>();
		app.use('*', requireAdminSession({
			prefix: '/admin',
			onDenied: () => new Response('not found', { status: 404 }),
		}));
		app.get('*', (c) => c.text('spa'));

		const res = await app.request('/admin/ui');
		expect(res.status).toBe(404);
	});

	it.each(['/', '/projects', '/administrator', '/settings/admin'])('leaves %s alone for a non-admin', async (path) => {
		const res = await load(adminApp(sessionRedis({ isAdmin: false })), path);
		expect(res.status).toBe(200);
	});
});
