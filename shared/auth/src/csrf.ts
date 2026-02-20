/**
 * CSRF protection middleware
 *
 * Validates X-CSRF-Token header on state-changing requests (POST, PUT, DELETE, PATCH)
 * Token must match the csrfToken stored in the session (Redis).
 *
 * The CSRF token is also set as a cookie (non-HttpOnly) so the client can read it
 * and include it in the header - but validation is always against Redis.
 */

import type { Context, MiddlewareHandler } from 'hono';
import type { Redis } from 'ioredis';
import { getCookie } from 'hono/cookie';
import { getSession } from './session.ts';
import { SESSION_COOKIE_NAME } from './types.ts';

export const CSRF_HEADER_NAME = 'X-CSRF-Token';

export interface CsrfMiddlewareOptions {
	/** Paths that don't require CSRF validation */
	excludePaths?: string[];
}

/**
 * HTTP methods that require CSRF validation (state-changing)
 */
const CSRF_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/**
 * Check if a path matches any of the excluded patterns
 */
function isExcludedPath(path: string, excludePaths: string[]): boolean {
	return excludePaths.some((pattern) => {
		// Exact match
		if (pattern === path) return true;

		// Wildcard match (e.g., /auth/*)
		if (pattern.endsWith('/*')) {
			const prefix = pattern.slice(0, -1);
			return path.startsWith(prefix);
		}

		return false;
	});
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function secureCompare(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}

	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}

/**
 * Create CSRF protection middleware for Hono
 *
 * @example
 * ```typescript
 * import { csrfMiddleware } from '@specboard/auth';
 *
 * app.use('*', csrfMiddleware(redis, {
 *   excludePaths: ['/api/auth/login', '/api/auth/signup'],
 * }));
 * ```
 */
export function csrfMiddleware(
	redis: Redis,
	options: CsrfMiddlewareOptions = {}
): MiddlewareHandler {
	const { excludePaths = [] } = options;

	return async (c: Context, next) => {
		const method = c.req.method;

		// Only validate CSRF for state-changing methods
		if (!CSRF_METHODS.has(method)) {
			return next();
		}

		const path = new URL(c.req.url).pathname;

		// Skip CSRF for excluded paths
		if (isExcludedPath(path, excludePaths)) {
			return next();
		}

		// Get session ID from cookie
		const sessionId = getCookie(c, SESSION_COOKIE_NAME);
		if (!sessionId) {
			return c.json({ error: 'Forbidden' }, 403);
		}

		// Get session from Redis (source of truth)
		const session = await getSession(redis, sessionId);
		if (!session) {
			return c.json({ error: 'Forbidden' }, 403);
		}

		// Get CSRF token from header
		const csrfToken = c.req.header(CSRF_HEADER_NAME);
		if (!csrfToken) {
			return c.json({ error: 'Missing CSRF token' }, 403);
		}

		// Validate CSRF token against session (Redis)
		if (!secureCompare(csrfToken, session.csrfToken)) {
			return c.json({ error: 'Invalid CSRF token' }, 403);
		}

		return next();
	};
}
