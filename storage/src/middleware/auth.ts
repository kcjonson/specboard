/**
 * Internal API key authentication middleware.
 * Storage service is only called by main API, never directly by clients.
 */

import type { Context, Next } from 'hono';
import crypto from 'crypto';

const STORAGE_API_KEY = process.env.STORAGE_API_KEY;

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);

	// Dummy comparison to prevent timing attacks from revealing length differences
	if (bufA.length !== bufB.length) {
		crypto.timingSafeEqual(bufA, bufA);
		return false;
	}

	return crypto.timingSafeEqual(bufA, bufB);
}

export async function apiKeyAuth(c: Context, next: Next): Promise<Response | void> {
	// Skip auth for health check
	if (c.req.path === '/health') {
		return next();
	}

	const apiKey = c.req.header('X-Internal-API-Key');

	if (!STORAGE_API_KEY) {
		console.error('STORAGE_API_KEY not configured');
		return c.json({ error: 'Service misconfigured' }, 500);
	}

	if (!apiKey || !timingSafeEqual(apiKey, STORAGE_API_KEY)) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	return next();
}
