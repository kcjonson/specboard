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
 * Admin path gate options
 */
export interface AdminPathOptions {
	/** Path prefix to gate, e.g. '/admin'; covers the prefix itself and everything under it */
	prefix: string;
	/**
	 * Whether the session's user is a site admin, read fresh from the source
	 * of truth on every call. A rejection denies, same as false.
	 */
	isAdmin: (sessionId: string) => Promise<boolean>;
	/** Response for a request under the prefix that isn't an admin's */
	onDenied: (requestUrl: URL) => Response | Promise<Response>;
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
