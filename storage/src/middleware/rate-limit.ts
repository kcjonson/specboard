/**
 * Per-caller rate limiting, for each API key and client. The storage service is internal
 * (only the API and the sync Lambda hold the key), so the limit is a guard against a
 * runaway caller, not a quota.
 *
 * The API gets 1000 requests a minute: its traffic is people editing, a few requests per
 * action. The sync Lambda sends `X-Storage-Client: sync` and gets its own, much larger
 * budget, 30,000 a minute (500 a second). A full sync makes about one request per file
 * (an upload or an unavailable record) plus one per pruned file, at most ten at a time;
 * at a typical 20-50 ms each that's 12,000-30,000 a minute, so a repository of several
 * thousand files finishes in a few minutes without waiting on the limit, while a loop
 * gone wrong still hits it within seconds. Separate budgets also mean a big sync never
 * stalls the API, and the API's traffic never stalls a sync.
 *
 * In memory, per task: with several storage tasks each keeps its own counts.
 */

import type { Context, Next } from 'hono';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const API_MAX_REQUESTS = 1000;
const SYNC_MAX_REQUESTS = 30_000;

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

/** The middleware, with its own counts (one per app; tests make their own). */
export function createRateLimit(
	{ windowMs = RATE_LIMIT_WINDOW_MS, apiMaxRequests = API_MAX_REQUESTS, syncMaxRequests = SYNC_MAX_REQUESTS, now = Date.now } = {}
): (c: Context, next: Next) => Promise<Response | void> {
	const store = new Map<string, RateLimitEntry>();
	return async (c, next) => {
		const apiKey = c.req.header('x-internal-api-key') || 'anonymous';
		const client = c.req.header('x-storage-client') === 'sync' ? 'sync' : 'api';
		const key = `${apiKey}:${client}`;
		const at = now();

		const existing = store.get(key);
		if (!existing || at > existing.resetAt) {
			store.set(key, { count: 1, resetAt: at + windowMs });
			await next();
			return;
		}

		if (existing.count >= (client === 'sync' ? syncMaxRequests : apiMaxRequests)) {
			const retryAfter = Math.ceil((existing.resetAt - at) / 1000);
			c.header('Retry-After', String(Math.max(retryAfter, 1)));
			return c.json({ error: 'Too many requests' }, 429);
		}

		existing.count++;
		await next();
	};
}
