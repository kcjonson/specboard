// Session management
export {
	generateSessionId,
	createSession,
	getSession,
	updateSession,
	deleteSession,
	sessionExists,
} from './session.js';

// Middleware
export {
	authMiddleware,
	getUser,
	getSessionId,
	type AuthVariables,
} from './middleware.js';

// Types
export {
	type Session,
	type AuthUser,
	type AuthMiddlewareOptions,
	SESSION_COOKIE_NAME,
	SESSION_TTL_SECONDS,
} from './types.js';
