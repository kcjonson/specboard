/**
 * Rate limiting middleware using Redis
 *
 * Provides configurable rate limits for different endpoints:
 * - /api/auth/login: 5 attempts per 15 minutes
 * - /api/auth/signup: 3 per hour per IP
 * - /api/auth/forgot: 3 per hour per email
 * - General API: 100 requests per minute
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
 * import { rateLimitMiddleware } from '@doc-platform/auth';
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

		// Check rate limit
		const { allowed, remaining, resetIn } = await checkRateLimit(
			redis,
			key,
			config.maxRequests,
			config.windowSeconds
		);

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
 * Pre-configured rate limit configs per spec
 */
export const RATE_LIMIT_CONFIGS = {
	/** /api/auth/login: 5 attempts per 15 minutes */
	login: {
		maxRequests: 5,
		windowSeconds: 15 * 60,
		message: 'Too many login attempts, please try again in 15 minutes',
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

	/** /api/auth/resend-verification: 3 per hour per IP */
	resendVerification: {
		maxRequests: 3,
		windowSeconds: 60 * 60,
		message: 'Too many verification email requests, please try again in an hour',
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

	/** AI Chat: 20 per minute (protect user's API credits and server resources) */
	chat: {
		maxRequests: 20,
		windowSeconds: 60,
		message: 'Too many chat requests, please slow down',
	} satisfies RateLimitConfig,
} as const;
