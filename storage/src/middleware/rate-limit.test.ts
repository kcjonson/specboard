/**
 * The sync's requests have their own budget: a full sync using all of its allowance
 * doesn't refuse the API, and the API's traffic doesn't refuse the sync.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createRateLimit } from './rate-limit.ts';

function app(): Hono {
	const hono = new Hono();
	hono.use('*', createRateLimit({ maxRequests: 2, now: () => 1_000 }));
	hono.get('/x', (c) => c.json({ ok: true }));
	return hono;
}

function call(hono: Hono, client?: string): Promise<Response> {
	return Promise.resolve(hono.request('/x', {
		headers: { 'X-Internal-API-Key': 'key', ...(client ? { 'X-Storage-Client': client } : {}) },
	}));
}

describe('createRateLimit', () => {
	it('counts sync requests apart from the API\'s', async () => {
		const hono = app();

		expect((await call(hono, 'sync')).status).toBe(200);
		expect((await call(hono, 'sync')).status).toBe(200);
		const refused = await call(hono, 'sync');
		expect(refused.status).toBe(429);
		expect(refused.headers.get('Retry-After')).toBe('60');

		expect((await call(hono)).status).toBe(200);
		expect((await call(hono, 'anything-else')).status).toBe(200);
		expect((await call(hono)).status).toBe(429);
	});
});
