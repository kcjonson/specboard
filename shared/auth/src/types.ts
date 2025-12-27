/**
 * Session data stored in Redis (auth-only, minimal)
 */
export interface Session {
	userId: string;
	createdAt: number;
	lastAccessedAt: number;
}

/**
 * User data attached to request context
 */
export interface AuthUser {
	id: string;
}

/**
 * Auth middleware options
 */
export interface AuthMiddlewareOptions {
	/** Paths that don't require authentication */
	excludePaths?: string[];
	/** Custom handler for unauthenticated requests. Receives the full request URL. */
	onUnauthenticated?: (requestUrl: URL) => Response | Promise<Response>;
}

/**
 * Session cookie name
 */
export const SESSION_COOKIE_NAME = 'session_id';

/**
 * Session TTL in seconds (30 days)
 */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
