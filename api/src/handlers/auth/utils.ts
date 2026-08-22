/**
 * Auth handler utilities
 */

import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import type { Redis } from 'ioredis';
import {
	generateSessionId,
	createSession,
	SESSION_COOKIE_NAME,
	CSRF_COOKIE_NAME,
	SESSION_TTL_SECONDS,
	type AuthMethod,
} from '@specboard/auth';

/**
 * Auth event types for logging
 */
export type AuthEvent =
	| 'login_success'
	| 'login_failure'
	| 'logout'
	| 'signup_success'
	| 'email_verified'
	| 'password_reset'
	| 'password_changed'
	| 'magic_link_requested'
	| 'magic_link_login'
	| 'magic_link_failure';

/**
 * Structured auth event logging for CloudWatch Logs Insights
 */
export function logAuthEvent(
	event: AuthEvent,
	data: Record<string, unknown>
): void {
	console.log(
		JSON.stringify({
			type: 'auth',
			event,
			timestamp: new Date().toISOString(),
			...data,
		})
	);
}

/**
 * Check if request is over HTTPS (directly or via ALB/proxy)
 */
export function isSecureRequest(context: Context): boolean {
	// Check X-Forwarded-Proto header (set by ALB/proxies)
	const forwardedProto = context.req.header('X-Forwarded-Proto');
	if (forwardedProto === 'https') {
		return true;
	}
	// Fallback to checking the URL scheme
	return new URL(context.req.url).protocol === 'https:';
}

/**
 * Get valid invite keys from environment variable.
 * Keys are stored as a comma-separated list.
 */
export function getValidInviteKeys(): Set<string> {
	const keysEnv = process.env.INVITE_KEYS || '';
	const keys = keysEnv.split(',').map(k => k.trim()).filter(k => k.length > 0);
	return new Set(keys);
}

/**
 * Validate an invite key against the configured list.
 */
export function isValidInviteKey(key: string): boolean {
	const validKeys = getValidInviteKeys();

	// If no keys are configured, reject all signups
	if (validKeys.size === 0) {
		return false;
	}

	return validKeys.has(key.trim());
}

/**
 * Create a Redis session and set the auth cookies on the response.
 * Shared by every successful-auth path (password, magic link, passkey).
 */
export async function establishSession(
	context: Context,
	redis: Redis,
	userId: string,
	authMethod: AuthMethod
): Promise<void> {
	const sessionId = generateSessionId();
	const csrfToken = await createSession(redis, sessionId, { userId, authMethod });
	const secure = isSecureRequest(context);

	// Session cookie is HttpOnly; CSRF cookie is readable by JS for the
	// double-submit pattern
	setCookie(context, SESSION_COOKIE_NAME, sessionId, {
		httpOnly: true,
		secure,
		sameSite: 'Lax',
		path: '/',
		maxAge: SESSION_TTL_SECONDS,
	});
	setCookie(context, CSRF_COOKIE_NAME, csrfToken, {
		httpOnly: false,
		secure,
		sameSite: 'Lax',
		path: '/',
		maxAge: SESSION_TTL_SECONDS,
	});
}

/**
 * App URL for building email links
 */
export const APP_URL = process.env.APP_URL || 'http://localhost:3000';
