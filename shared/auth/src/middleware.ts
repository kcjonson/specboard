import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import { getSession } from './session.js';
import type { AuthMiddlewareOptions, AuthUser } from './types.js';
import { SESSION_COOKIE_NAME } from './types.js';

/**
 * Hono variables type for auth context
 */
export interface AuthVariables {
	user: AuthUser;
	sessionId: string;
}

/**
 * Default handler for unauthenticated requests
 */
function defaultOnUnauthenticated(_requestUrl: URL): Response {
	return new Response(JSON.stringify({ error: 'Unauthorized' }), {
		status: 401,
		headers: { 'Content-Type': 'application/json' },
	});
}

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
 * Create auth middleware for Hono
 *
 * @example
 * ```typescript
 * import { Redis } from 'ioredis';
 * import { authMiddleware } from '@doc-platform/auth';
 *
 * const redis = new Redis(process.env.REDIS_URL);
 *
 * app.use('*', authMiddleware(redis, {
 *   excludePaths: ['/health', '/auth/*'],
 *   onUnauthenticated: () => Response.redirect('/login'),
 * }));
 * ```
 */
export function authMiddleware(
	redis: Redis,
	options: AuthMiddlewareOptions = {}
): MiddlewareHandler<{ Variables: AuthVariables }> {
	const {
		excludePaths = [],
		onUnauthenticated = defaultOnUnauthenticated,
	} = options;

	return async (c: Context<{ Variables: AuthVariables }>, next) => {
		const requestUrl = new URL(c.req.url);
		const path = requestUrl.pathname;

		// Skip auth for excluded paths
		if (isExcludedPath(path, excludePaths)) {
			return next();
		}

		// Get session ID from cookie
		const sessionId = getCookie(c, SESSION_COOKIE_NAME);

		if (!sessionId) {
			return onUnauthenticated(requestUrl);
		}

		// Validate session in Redis
		const session = await getSession(redis, sessionId);

		if (!session) {
			return onUnauthenticated(requestUrl);
		}

		// Attach user to context
		c.set('user', {
			id: session.userId,
			email: session.email,
			displayName: session.displayName,
		});
		c.set('sessionId', sessionId);

		return next();
	};
}

/**
 * Get the authenticated user from context
 * Throws if user is not authenticated (use after authMiddleware)
 */
export function getUser(c: Context<{ Variables: AuthVariables }>): AuthUser {
	const user = c.get('user');
	if (!user) {
		throw new Error('User not authenticated');
	}
	return user;
}

/**
 * Get the session ID from context
 * Throws if not authenticated (use after authMiddleware)
 */
export function getSessionId(
	c: Context<{ Variables: AuthVariables }>
): string {
	const sessionId = c.get('sessionId');
	if (!sessionId) {
		throw new Error('No session');
	}
	return sessionId;
}
