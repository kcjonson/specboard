/**
 * How a session was established
 */
export type AuthMethod = 'password' | 'magic_link' | 'passkey';

/**
 * Session data stored in Redis (auth-only, minimal)
 */
export interface Session {
	userId: string;
	csrfToken: string;
	createdAt: number;
	lastAccessedAt: number;
	/** Absent on sessions created before auth methods were recorded */
	authMethod?: AuthMethod;
	/**
	 * False while the user still needs onboarding (no username yet from
	 * email-only signup); the frontend server redirects SPA document loads
	 * to /onboarding while false. Absent on pre-feature sessions = complete.
	 */
	profileComplete?: boolean;
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
 * CSRF token cookie name (non-HttpOnly so JS can read it for double-submit)
 */
export const CSRF_COOKIE_NAME = 'csrf_token';

/**
 * Session TTL in seconds (30 days)
 */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
