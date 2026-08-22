// Session management
export {
	generateSessionId,
	generateCsrfToken,
	createSession,
	getSession,
	updateSession,
	deleteSession,
	sessionExists,
} from './session.ts';

// Auth middleware
export {
	authMiddleware,
	getUser,
	getSessionId,
	type AuthVariables,
} from './middleware.ts';

// CSRF middleware
export {
	csrfMiddleware,
	CSRF_HEADER_NAME,
	type CsrfMiddlewareOptions,
} from './csrf.ts';

// Rate limiting middleware
export {
	rateLimitMiddleware,
	checkRateLimitKey,
	failureLimitKey,
	isFailureLimited,
	recordFailure,
	clearFailures,
	RATE_LIMIT_CONFIGS,
	LOGIN_FAILURE_LIMIT,
	type RateLimitConfig,
	type RateLimitRule,
	type RateLimitMiddlewareOptions,
	type FailureLimitConfig,
} from './rate-limit.ts';

// Password utilities
export {
	validatePassword,
	hashPassword,
	verifyPassword,
	type PasswordValidationError,
	type PasswordValidationResult,
} from './password.ts';

// MCP OAuth middleware
export {
	mcpAuthMiddleware,
	requireScope,
	getMcpToken,
	type McpTokenPayload,
	type McpAuthVariables,
	type McpAuthMiddlewareOptions,
} from './mcp.ts';

// Admin middleware
export {
	requireAdmin,
	getAdminUser,
	isValidRole,
	hasRole,
	hasAnyRole,
	type AdminAuthVariables,
} from './admin.ts';

// Token utilities
export {
	generateToken,
	hashToken,
	verifyToken,
	getTokenExpiry,
	isTokenExpired,
	generateLoginCode,
	normalizeLoginCode,
	TOKEN_EXPIRY_MS,
	MAGIC_LINK_EXPIRY_MS,
	LOGIN_CODE_LENGTH,
} from './tokens.ts';

// Encryption utilities
export {
	encrypt,
	decrypt,
	maskApiKey,
	type EncryptedData,
} from './encryption.ts';

// Types
export {
	type Session,
	type AuthMethod,
	type AuthUser,
	type AuthMiddlewareOptions,
	SESSION_COOKIE_NAME,
	CSRF_COOKIE_NAME,
	SESSION_TTL_SECONDS,
} from './types.ts';
