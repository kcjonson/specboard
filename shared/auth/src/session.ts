import { Redis } from 'ioredis';
import crypto from 'node:crypto';
import type { Session } from './types.js';
import { SESSION_TTL_SECONDS } from './types.js';

/**
 * Generate a cryptographically random session ID
 */
export function generateSessionId(): string {
	return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a cryptographically random CSRF token
 */
export function generateCsrfToken(): string {
	return crypto.randomBytes(32).toString('hex');
}

/**
 * Get the Redis key for a session
 */
function sessionKey(sessionId: string): string {
	return `session:${sessionId}`;
}

/**
 * Create a new session in Redis
 * Automatically generates a CSRF token if not provided
 */
export async function createSession(
	redis: Redis,
	sessionId: string,
	data: Omit<Session, 'createdAt' | 'lastAccessedAt' | 'csrfToken'> & { csrfToken?: string }
): Promise<string> {
	const now = Date.now();
	const csrfToken = data.csrfToken || generateCsrfToken();
	const session: Session = {
		userId: data.userId,
		csrfToken,
		createdAt: now,
		lastAccessedAt: now,
	};

	await redis.setex(
		sessionKey(sessionId),
		SESSION_TTL_SECONDS,
		JSON.stringify(session)
	);

	return csrfToken;
}

/**
 * Get a session from Redis
 * Updates lastAccessedAt and refreshes TTL (sliding expiration)
 */
export async function getSession(
	redis: Redis,
	sessionId: string
): Promise<Session | null> {
	const key = sessionKey(sessionId);
	const data = await redis.get(key);

	if (!data) {
		return null;
	}

	let session: Session;
	try {
		session = JSON.parse(data);
	} catch {
		// Corrupted session data - delete and return null
		await redis.del(key);
		return null;
	}

	// Update last accessed time and refresh TTL
	session.lastAccessedAt = Date.now();
	await redis.setex(key, SESSION_TTL_SECONDS, JSON.stringify(session));

	return session;
}

/**
 * Update session data (e.g., after token refresh)
 * Uses atomic get + update to avoid race conditions
 */
export async function updateSession(
	redis: Redis,
	sessionId: string,
	updates: Partial<Omit<Session, 'createdAt' | 'lastAccessedAt'>>
): Promise<boolean> {
	const key = sessionKey(sessionId);
	const data = await redis.get(key);

	if (!data) {
		return false;
	}

	let session: Session;
	try {
		session = JSON.parse(data);
	} catch {
		// Corrupted session data - delete and return false
		await redis.del(key);
		return false;
	}

	const updated: Session = {
		...session,
		...updates,
		lastAccessedAt: Date.now(),
	};

	await redis.setex(key, SESSION_TTL_SECONDS, JSON.stringify(updated));

	return true;
}

/**
 * Delete a session from Redis
 */
export async function deleteSession(
	redis: Redis,
	sessionId: string
): Promise<void> {
	await redis.del(sessionKey(sessionId));
}

/**
 * Check if a session exists without updating it
 */
export async function sessionExists(
	redis: Redis,
	sessionId: string
): Promise<boolean> {
	const exists = await redis.exists(sessionKey(sessionId));
	return exists === 1;
}
