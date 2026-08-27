/**
 * Rate limiting middleware using Redis
 *
 * Two layers:
 * - Path-level middleware: outcome-blind request caps per IP
 *   (/api/auth/login: 100 per 15 min, /api/auth/signup: 3 per hour,
 *   general API: 100 per minute)
 * - Failure limit for credential endpoints: 5 failed attempts per 15 min,
 *   keyed identifier+IP, enforced in the handler where the auth outcome
 *   is known (isFailureLimited/recordFailure/clearFailures)
 */

import type { Context, MiddlewareHandler } from 'hono';
import type { Redis } from 'ioredis';
import crypto from 'node:crypto';

export interface RateLimitConfig {
	/** Maximum number of requests allowed in the window */
	maxRequests: number;
	/** Time window in seconds */
	windowSeconds: number;
	/** Optional custom key generator (default: uses IP) */
	keyGenerator?: (c: Context) => string | null;
	/** Optional message for rate limit exceeded */
	message?: string;
}

export interface RateLimitRule {
	/** Path pattern to match (exact or wildcard with *) */
	path: string;
	/** Rate limit configuration */
	config: RateLimitConfig;
}

export interface RateLimitMiddlewareOptions {
	/** Specific rules for different paths (checked in order) */
	rules?: RateLimitRule[];
	/** Default rate limit for all other requests */
	defaultLimit?: RateLimitConfig;
	/** Paths to completely skip rate limiting */
	excludePaths?: string[];
}

/**
 * Get client IP from request headers or connection
 *
 * In production behind a trusted proxy/load balancer (like ALB), the proxy
 * appends the real client IP to X-Forwarded-For. We use the LAST IP in the
 * chain as it's the one added by our trusted proxy, not client-supplied.
 */
function getClientIp(c: Context): string {
	// Check common proxy headers
	const forwarded = c.req.header('X-Forwarded-For');
	if (forwarded) {
		// X-Forwarded-For contains comma-separated IPs
		// The LAST IP is the one appended by our trusted proxy (ALB)
		// Using first IP would allow client spoofing
		const ips = forwarded.split(',').map((ip) => ip.trim());
		const lastIp = ips[ips.length - 1];
		if (lastIp) {
			return lastIp;
		}
	}

	const realIp = c.req.header('X-Real-IP');
	if (realIp) {
		return realIp;
	}

	// Fallback to unknown (in development)
	return 'unknown';
}

/**
 * Check if a path matches a pattern
 */
function pathMatches(path: string, pattern: string): boolean {
	if (pattern === path) return true;

	if (pattern.endsWith('/*')) {
		const prefix = pattern.slice(0, -1);
		return path.startsWith(prefix);
	}

	return false;
}

/**
 * Check rate limit using Redis sliding window
 * Returns true if request is allowed, false if rate limited
 */
async function checkRateLimit(
	redis: Redis,
	key: string,
	maxRequests: number,
	windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
	const now = Math.floor(Date.now() / 1000);
	const windowStart = now - windowSeconds;

	// First, check current count BEFORE adding (to avoid off-by-one error)
	const checkPipeline = redis.pipeline();
	checkPipeline.zremrangebyscore(key, 0, windowStart);
	checkPipeline.zcard(key);
	const checkResults = await checkPipeline.exec();

	if (!checkResults) {
		console.error('Rate limit Redis error');
		return { allowed: true, remaining: maxRequests, resetIn: windowSeconds };
	}

	// Get count BEFORE adding current request
	const countResult = checkResults[1];
	const currentCount = (countResult && countResult[1] as number) || 0;

	// Check if limit would be exceeded
	const allowed = currentCount < maxRequests;
	const remaining = Math.max(0, maxRequests - currentCount - (allowed ? 1 : 0));

	if (allowed) {
		// Only add the request if it's allowed
		// Use crypto.randomBytes for secure unique ID instead of Math.random
		const uniqueId = crypto.randomBytes(8).toString('hex');
		await redis.pipeline()
			.zadd(key, now.toString(), `${now}-${uniqueId}`)
			.expire(key, windowSeconds)
			.exec();
	}

	return {
		allowed,
		remaining,
		resetIn: windowSeconds,
	};
}

/**
 * Create rate limiting middleware for Hono
 *
 * @example
 * ```typescript
 * import { rateLimitMiddleware } from '@specboard/auth';
 *
 * app.use('*', rateLimitMiddleware(redis, {
 *   rules: [
 *     { path: '/api/auth/login', config: { maxRequests: 5, windowSeconds: 900 } },
 *     { path: '/api/auth/signup', config: { maxRequests: 3, windowSeconds: 3600 } },
 *   ],
 *   defaultLimit: { maxRequests: 100, windowSeconds: 60 },
 * }));
 * ```
 */
export function rateLimitMiddleware(
	redis: Redis,
	options: RateLimitMiddlewareOptions = {}
): MiddlewareHandler {
	const { rules = [], defaultLimit, excludePaths = [] } = options;

	return async (c: Context, next) => {
		const path = new URL(c.req.url).pathname;

		// Skip excluded paths
		for (const excludePath of excludePaths) {
			if (pathMatches(path, excludePath)) {
				return next();
			}
		}

		// Find matching rule
		let config: RateLimitConfig | undefined;
		for (const rule of rules) {
			if (pathMatches(path, rule.path)) {
				config = rule.config;
				break;
			}
		}

		// Fall back to default limit
		if (!config) {
			config = defaultLimit;
		}

		// No rate limit configured for this path
		if (!config) {
			return next();
		}

		// Generate rate limit key
		let key: string;
		if (config.keyGenerator) {
			const customKey = config.keyGenerator(c);
			if (customKey === null) {
				// Key generator returned null, skip rate limiting
				return next();
			}
			key = `ratelimit:${path}:${customKey}`;
		} else {
			const ip = getClientIp(c);
			key = `ratelimit:${path}:${ip}`;
		}

		// Check rate limit; fails open so a Redis outage doesn't 500 every request
		let allowed: boolean;
		let remaining: number;
		let resetIn: number;
		try {
			({ allowed, remaining, resetIn } = await checkRateLimit(
				redis,
				key,
				config.maxRequests,
				config.windowSeconds
			));
		} catch (error) {
			console.error('Rate limit check error:', error instanceof Error ? error.message : error);
			return next();
		}

		// Set rate limit headers
		c.header('X-RateLimit-Limit', config.maxRequests.toString());
		c.header('X-RateLimit-Remaining', remaining.toString());
		c.header('X-RateLimit-Reset', resetIn.toString());

		if (!allowed) {
			c.header('Retry-After', resetIn.toString());
			return c.json(
				{
					error: config.message || 'Too many requests, please try again later',
				},
				429
			);
		}

		return next();
	};
}

/**
 * Sliding-window check for a caller-built key, for limits the middleware
 * can't express (e.g. per-email buckets that need the request body).
 * Records the request when allowed. Fails open on Redis errors.
 */
export async function checkRateLimitKey(
	redis: Redis,
	key: string,
	config: Pick<RateLimitConfig, 'maxRequests' | 'windowSeconds'>
): Promise<boolean> {
	try {
		const { allowed } = await checkRateLimit(redis, key, config.maxRequests, config.windowSeconds);
		return allowed;
	} catch (error) {
		console.error('Rate limit key check error:', error instanceof Error ? error.message : error);
		return true;
	}
}

/**
 * Failure-based limit for credential endpoints.
 *
 * Counts only failed attempts, keyed per identifier+IP. Check with
 * isFailureLimited before verifying credentials, recordFailure on a failed
 * attempt, clearFailures on success. Clearing on success is safe at this
 * keying: a success on one account can't reset another account's counter,
 * and can't reset this account's counter for other IPs.
 * All operations fail open on Redis errors, matching the middleware.
 */
export interface FailureLimitConfig {
	/** Maximum failed attempts allowed in the window */
	maxFailures: number;
	/** Time window in seconds */
	windowSeconds: number;
	/** Message returned when the limit is hit */
	message: string;
}

/** Login: 5 failed attempts per 15 minutes per identifier+IP */
export const LOGIN_FAILURE_LIMIT = {
	maxFailures: 5,
	windowSeconds: 15 * 60,
	message: 'Too many failed login attempts, please try again in 15 minutes',
} as const satisfies FailureLimitConfig;

/**
 * Build the failure counter key for an identifier (username/email) and the
 * request's client IP.
 *
 * The key material is hashed: identifiers can be emails (including ones
 * belonging to no account), and the privacy policy doesn't disclose storing
 * email+IP pairs. Only exact-match lookups are ever needed, so a digest
 * loses nothing.
 */
export function failureLimitKey(c: Context, identifier: string): string {
	const material = `${identifier.trim().toLowerCase()}|${getClientIp(c)}`;
	const digest = crypto.createHash('sha256').update(material).digest('hex').slice(0, 32);
	return `authfail:${digest}`;
}

export async function isFailureLimited(
	redis: Redis,
	key: string,
	config: FailureLimitConfig
): Promise<boolean> {
	const now = Math.floor(Date.now() / 1000);
	try {
		const results = await redis.pipeline()
			.zremrangebyscore(key, 0, now - config.windowSeconds)
			.zcard(key)
			.exec();
		if (!results) return false;
		const count = (results[1] && results[1][1] as number) || 0;
		return count >= config.maxFailures;
	} catch (error) {
		console.error('Failure limit check error:', error instanceof Error ? error.message : error);
		return false;
	}
}

export async function recordFailure(
	redis: Redis,
	key: string,
	config: FailureLimitConfig
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	const uniqueId = crypto.randomBytes(8).toString('hex');
	try {
		await redis.pipeline()
			.zadd(key, now.toString(), `${now}-${uniqueId}`)
			.expire(key, config.windowSeconds)
			.exec();
	} catch (error) {
		console.error('Failure limit record error:', error instanceof Error ? error.message : error);
	}
}

export async function clearFailures(redis: Redis, key: string): Promise<void> {
	try {
		await redis.del(key);
	} catch (error) {
		console.error('Failure limit clear error:', error instanceof Error ? error.message : error);
	}
}

/**
 * Pre-configured rate limit configs per spec
 */
export const RATE_LIMIT_CONFIGS = {
	/**
	 * /api/auth/login: coarse per-IP cap on all requests. Failed attempts
	 * have a stricter per-identifier+IP limit enforced in the login handler
	 * (LOGIN_FAILURE_LIMIT).
	 */
	login: {
		maxRequests: 100,
		windowSeconds: 15 * 60,
		message: 'Too many requests, please try again in 15 minutes',
	} satisfies RateLimitConfig,

	/** /api/auth/signup: 3 per hour per IP */
	signup: {
		maxRequests: 3,
		windowSeconds: 60 * 60,
		message: 'Too many signup attempts, please try again in an hour',
	} satisfies RateLimitConfig,

	/** /api/auth/forgot: 3 per hour per email (requires custom key generator) */
	forgot: {
		maxRequests: 3,
		windowSeconds: 60 * 60,
		message: 'Too many password reset requests, please try again in an hour',
	} satisfies RateLimitConfig,

	/**
	 * /api/auth/magic-link/request: coarse per-IP cap. A stricter per-email
	 * cap (magicLinkEmail) runs inside the handler, where the body is readable.
	 */
	magicLinkRequest: {
		maxRequests: 5,
		windowSeconds: 15 * 60,
		message: 'Too many sign-in code requests, please try again later',
	} satisfies RateLimitConfig,

	/** Per-email cap for magic link requests; enforced in-handler via checkRateLimitKey */
	magicLinkEmail: {
		maxRequests: 3,
		windowSeconds: 60 * 60,
		message: 'Too many sign-in code requests for this email, please try again in an hour',
	} satisfies RateLimitConfig,

	/**
	 * /api/auth/magic-link/verify: per-IP cap on guesses. Each token also
	 * carries its own attempt counter, enforced in the handler.
	 */
	magicLinkVerify: {
		maxRequests: 10,
		windowSeconds: 15 * 60,
		message: 'Too many attempts, please try again later',
	} satisfies RateLimitConfig,

	/**
	 * /api/auth/webauthn/login/options: conditional-UI autofill fires this on
	 * every login page load, so allow a generous per-IP rate.
	 */
	webauthnLoginOptions: {
		maxRequests: 30,
		windowSeconds: 60,
		message: 'Too many requests, please slow down',
	} satisfies RateLimitConfig,

	/** /api/auth/resend-verification: 3 per hour per IP */
	resendVerification: {
		maxRequests: 3,
		windowSeconds: 60 * 60,
		message: 'Too many verification email requests, please try again in an hour',
	} satisfies RateLimitConfig,

	/**
	 * /api/waitlist: 10 per hour per IP. The endpoint is unauthenticated and
	 * emails whatever address it is handed, so the general API limit would
	 * make it a usable mail relay. Kept well above the auth-flow limits
	 * because this one is keyed per IP with no email component: a whole
	 * office behind one NAT signing up is the success case, not abuse. The
	 * INSERT ... ON CONFLICT already caps each address at one email ever, so
	 * this only has to bound distinct addresses reachable from one IP.
	 */
	waitlist: {
		maxRequests: 10,
		windowSeconds: 60 * 60,
		message: 'Too many signup requests, please try again in an hour',
	} satisfies RateLimitConfig,

	/** General API: 100 requests per minute */
	api: {
		maxRequests: 100,
		windowSeconds: 60,
		message: 'Rate limit exceeded, please slow down',
	} satisfies RateLimitConfig,

	/** OAuth token endpoint: 10 per minute per IP (prevents auth code brute force) */
	oauthToken: {
		maxRequests: 10,
		windowSeconds: 60,
		message: 'Too many token requests, please try again later',
	} satisfies RateLimitConfig,

	/** OAuth authorize: 5 per 15 minutes per IP (same as login) */
	oauthAuthorize: {
		maxRequests: 5,
		windowSeconds: 15 * 60,
		message: 'Too many authorization attempts, please try again in 15 minutes',
	} satisfies RateLimitConfig,

	/** AI Chat: 40 per minute (protect user's API credits and server resources) */
	chat: {
		maxRequests: 40,
		windowSeconds: 60,
		message: 'Too many chat requests, please slow down',
	} satisfies RateLimitConfig,
} as const;
