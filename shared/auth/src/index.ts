// Session management
export {
	generateSessionId,
	generateCsrfToken,
	createSession,
	getSession,
	updateSession,
	deleteSession,
	sessionExists,
} from './session.js';

// Auth middleware
export {
	authMiddleware,
	getUser,
	getSessionId,
	type AuthVariables,
} from './middleware.js';

// CSRF middleware
export {
	csrfMiddleware,
	CSRF_HEADER_NAME,
	type CsrfMiddlewareOptions,
} from './csrf.js';

// Rate limiting middleware
export {
	rateLimitMiddleware,
	RATE_LIMIT_CONFIGS,
	type RateLimitConfig,
	type RateLimitRule,
	type RateLimitMiddlewareOptions,
} from './rate-limit.js';

// Password utilities
export {
	validatePassword,
	hashPassword,
	verifyPassword,
	type PasswordValidationError,
	type PasswordValidationResult,
} from './password.js';

// MCP OAuth middleware
export {
	mcpAuthMiddleware,
	requireScope,
	getMcpToken,
	type McpTokenPayload,
	type McpAuthVariables,
} from './mcp.js';

// Admin middleware
export {
	requireAdmin,
	getAdminUser,
	isValidRole,
	hasRole,
	hasAnyRole,
	type AdminAuthVariables,
} from './admin.js';

// Token utilities
export {
	generateToken,
	hashToken,
	verifyToken,
	getTokenExpiry,
	isTokenExpired,
	TOKEN_EXPIRY_MS,
} from './tokens.js';

// Types
export {
	type Session,
	type AuthUser,
	type AuthMiddlewareOptions,
	SESSION_COOKIE_NAME,
	CSRF_COOKIE_NAME,
	SESSION_TTL_SECONDS,
} from './types.js';
