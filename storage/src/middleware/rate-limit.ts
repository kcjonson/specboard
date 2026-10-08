/**
 * Per-caller rate limiting: 1000 requests a minute for each API key and client. The sync
 * Lambda sends `X-Storage-Client: sync` and gets its own budget, so a full sync of a big
 * repository doesn't use up the API's, and the API's interactive traffic doesn't stall a
 * sync. Anything else counts as the API.
 *
 * In memory, per task: with several storage tasks each keeps its own counts.
 */

import type { Context, Next } from 'hono';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 1000;

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

/** The middleware, with its own counts (one per app; tests make their own). */
export function createRateLimit(
	{ windowMs = RATE_LIMIT_WINDOW_MS, maxRequests = RATE_LIMIT_MAX_REQUESTS, now = Date.now } = {}
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

		if (existing.count >= maxRequests) {
			const retryAfter = Math.ceil((existing.resetAt - at) / 1000);
			c.header('Retry-After', String(Math.max(retryAfter, 1)));
			return c.json({ error: 'Too many requests' }, 429);
		}

		existing.count++;
		await next();
	};
}
