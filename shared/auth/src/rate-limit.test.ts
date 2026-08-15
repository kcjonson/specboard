/**
 * Rate limit middleware + clearRateLimit tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';

import { rateLimitMiddleware, clearRateLimit } from './rate-limit.ts';

// Minimal in-memory stand-in for the Redis sorted-set commands the
// middleware uses (zremrangebyscore, zcard, zadd, expire via pipeline; del)
function createFakeRedis() {
	const sets = new Map<string, Map<string, number>>();

	const zremrangebyscore = (key: string, min: number, max: number): number => {
		const set = sets.get(key);
		if (!set) return 0;
		let removed = 0;
		for (const [member, score] of set) {
			if (score >= min && score <= max) {
				set.delete(member);
				removed++;
			}
		}
		return removed;
	};

	const fake = {
		sets,
		pipeline() {
			const ops: Array<() => unknown> = [];
			const p = {
				zremrangebyscore(key: string, min: number, max: number) {
					ops.push(() => zremrangebyscore(key, min, max));
					return p;
				},
				zcard(key: string) {
					ops.push(() => sets.get(key)?.size ?? 0);
					return p;
				},
				zadd(key: string, score: string, member: string) {
					ops.push(() => {
						const set = sets.get(key) ?? new Map<string, number>();
						set.set(member, Number(score));
						sets.set(key, set);
						return 1;
					});
					return p;
				},
				expire() {
					ops.push(() => 1);
					return p;
				},
				async exec() {
					return ops.map((op) => [null, op()] as [null, unknown]);
				},
			};
			return p;
		},
		async del(key: string) {
			return sets.delete(key) ? 1 : 0;
		},
	};

	return fake as typeof fake & Redis;
}

const LIMIT = 3;

function createApp(redis: Redis) {
	const app = new Hono();
	app.use(
		'*',
		rateLimitMiddleware(redis, {
			rules: [
				{
					path: '/api/auth/login',
					config: { maxRequests: LIMIT, windowSeconds: 900, message: 'Too many' },
				},
			],
		})
	);
	// Simulates the login handler: clears the counter on success only
	app.post('/api/auth/login', async (c) => {
		const { success } = await c.req.json<{ success: boolean }>();
		if (success) {
			await clearRateLimit(redis, c);
			return c.json({ ok: true });
		}
		return c.json({ error: 'Invalid credentials' }, 401);
	});
	return app;
}

function login(app: Hono, ip: string, success: boolean) {
	return app.request('/api/auth/login', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Forwarded-For': `1.2.3.4, ${ip}`,
		},
		body: JSON.stringify({ success }),
	});
}

describe('login rate limiting', () => {
	let redis: Redis;
	let app: Hono;

	beforeEach(() => {
		redis = createFakeRedis();
		app = createApp(redis);
	});

	it('blocks after maxRequests failed attempts', async () => {
		for (let i = 0; i < LIMIT; i++) {
			expect((await login(app, '10.0.0.1', false)).status).toBe(401);
		}
		expect((await login(app, '10.0.0.1', false)).status).toBe(429);
	});

	it('does not count successful logins toward the limit', async () => {
		for (let i = 0; i < LIMIT * 2; i++) {
			expect((await login(app, '10.0.0.1', true)).status).toBe(200);
		}
	});

	it('resets accumulated failures on successful login', async () => {
		await login(app, '10.0.0.1', false);
		await login(app, '10.0.0.1', false);
		expect((await login(app, '10.0.0.1', true)).status).toBe(200);
		// Full budget available again after the success
		for (let i = 0; i < LIMIT; i++) {
			expect((await login(app, '10.0.0.1', false)).status).toBe(401);
		}
		expect((await login(app, '10.0.0.1', false)).status).toBe(429);
	});

	it('only clears the counter for the succeeding IP', async () => {
		for (let i = 0; i < LIMIT; i++) {
			await login(app, '10.0.0.2', false);
		}
		expect((await login(app, '10.0.0.1', true)).status).toBe(200);
		expect((await login(app, '10.0.0.2', false)).status).toBe(429);
	});
});
