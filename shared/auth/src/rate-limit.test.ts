/**
 * Rate limit middleware + failure limit tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Redis } from 'ioredis';

import {
	rateLimitMiddleware,
	failureLimitKey,
	isFailureLimited,
	recordFailure,
	clearFailures,
	type FailureLimitConfig,
} from './rate-limit.ts';

// Minimal in-memory stand-in for the Redis sorted-set commands the
// limiters use (zremrangebyscore, zcard, zadd, expire via pipeline; del)
function createFakeRedis(): Redis {
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

	return fake as unknown as Redis;
}

const FAILURE_LIMIT: FailureLimitConfig = {
	maxFailures: 3,
	windowSeconds: 900,
	message: 'Too many failed attempts',
};

// Builds a Hono context for a given client IP without running a server
async function contextFor(ip: string): Promise<Context> {
	let captured: Context | undefined;
	const app = new Hono();
	app.get('/api/auth/login', (c) => {
		captured = c;
		return c.body(null, 204);
	});
	await app.request('/api/auth/login', { headers: { 'X-Forwarded-For': `1.2.3.4, ${ip}` } });
	if (!captured) throw new Error('handler did not run');
	return captured;
}

describe('failure limit', () => {
	let redis: Redis;

	beforeEach(() => {
		redis = createFakeRedis();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	async function key(identifier: string, ip: string): Promise<string> {
		return failureLimitKey(await contextFor(ip), identifier);
	}

	it('is not limited until maxFailures failures are recorded', async () => {
		const k = await key('alice', '10.0.0.1');
		for (let i = 0; i < FAILURE_LIMIT.maxFailures; i++) {
			expect(await isFailureLimited(redis, k, FAILURE_LIMIT)).toBe(false);
			await recordFailure(redis, k, FAILURE_LIMIT);
		}
		expect(await isFailureLimited(redis, k, FAILURE_LIMIT)).toBe(true);
	});

	it('clearFailures resets the counter for that key only', async () => {
		const victim = await key('victim', '10.0.0.1');
		const burner = await key('burner', '10.0.0.1');
		for (let i = 0; i < FAILURE_LIMIT.maxFailures; i++) {
			await recordFailure(redis, victim, FAILURE_LIMIT);
			await recordFailure(redis, burner, FAILURE_LIMIT);
		}
		// Successful burner login clears only the burner's key
		await clearFailures(redis, burner);
		expect(await isFailureLimited(redis, burner, FAILURE_LIMIT)).toBe(false);
		expect(await isFailureLimited(redis, victim, FAILURE_LIMIT)).toBe(true);
	});

	it('scopes the counter per IP', async () => {
		const homeIp = await key('alice', '10.0.0.1');
		const otherIp = await key('alice', '10.0.0.2');
		for (let i = 0; i < FAILURE_LIMIT.maxFailures; i++) {
			await recordFailure(redis, homeIp, FAILURE_LIMIT);
		}
		expect(await isFailureLimited(redis, homeIp, FAILURE_LIMIT)).toBe(true);
		expect(await isFailureLimited(redis, otherIp, FAILURE_LIMIT)).toBe(false);
	});

	it('normalizes the identifier in the key', async () => {
		expect(await key('  Alice@Example.COM ', '10.0.0.1')).toBe(
			await key('alice@example.com', '10.0.0.1')
		);
	});

	it('forgets failures older than the window', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
		const k = await key('alice', '10.0.0.1');
		for (let i = 0; i < FAILURE_LIMIT.maxFailures; i++) {
			await recordFailure(redis, k, FAILURE_LIMIT);
		}
		expect(await isFailureLimited(redis, k, FAILURE_LIMIT)).toBe(true);
		vi.setSystemTime(new Date('2026-08-15T12:16:00Z'));
		expect(await isFailureLimited(redis, k, FAILURE_LIMIT)).toBe(false);
	});
});

describe('rate limit middleware (coarse cap)', () => {
	it('counts all requests toward the cap regardless of outcome', async () => {
		const redis = createFakeRedis();
		const app = new Hono();
		app.use(
			'*',
			rateLimitMiddleware(redis, {
				rules: [
					{
						path: '/api/auth/login',
						config: { maxRequests: 5, windowSeconds: 900, message: 'Too many' },
					},
				],
			})
		);
		app.post('/api/auth/login', (c) => c.json({ ok: true }));

		const request = (): Promise<Response> =>
			Promise.resolve(
				app.request('/api/auth/login', {
					method: 'POST',
					headers: { 'X-Forwarded-For': '1.2.3.4, 10.0.0.1' },
				})
			);

		for (let i = 0; i < 5; i++) {
			expect((await request()).status).toBe(200);
		}
		expect((await request()).status).toBe(429);
	});
});
