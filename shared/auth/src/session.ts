import { Redis } from 'ioredis';
import crypto from 'node:crypto';
import type { Session } from './types.ts';
import { SESSION_TTL_SECONDS } from './types.ts';

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
	data: Omit<Session, 'createdAt' | 'csrfToken'> & { csrfToken?: string }
): Promise<string> {
	const csrfToken = data.csrfToken || generateCsrfToken();
	const session: Session = {
		userId: data.userId,
		csrfToken,
		createdAt: Date.now(),
		authMethod: data.authMethod,
		profileComplete: data.profileComplete,
		isAdmin: data.isAdmin,
	};

	await redis.setex(
		sessionKey(sessionId),
		SESSION_TTL_SECONDS,
		JSON.stringify(session)
	);

	return csrfToken;
}

/**
 * Get a session from Redis and slide its expiry. Only the TTL is touched:
 * rewriting the body here would race updateSession/updateUserSessions (and
 * resurrect sessions deleted mid-request), since every request reads it.
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

	await redis.expire(key, SESSION_TTL_SECONDS);

	return session;
}

/**
 * Merges ARGV[1] (a JSON object) into the session at KEYS[1] in one atomic
 * step. ARGV[2] is the new TTL in seconds, or 0 to keep the current one.
 * Returns 0 if the session is gone; corrupted data is deleted. cjson encodes
 * numbers with at most 14 significant digits (Redis caps the precision), so
 * integers stay exact only below 1e14; ms timestamps like createdAt are 13.
 */
const MERGE_SESSION_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
	return 0
end
local ok, session = pcall(cjson.decode, raw)
if not ok or type(session) ~= 'table' then
	redis.call('DEL', KEYS[1])
	return 0
end
for field, value in pairs(cjson.decode(ARGV[1])) do
	session[field] = value
end
local ttl = tonumber(ARGV[2])
if ttl > 0 then
	redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ttl)
else
	redis.call('SET', KEYS[1], cjson.encode(session), 'KEEPTTL')
end
return 1
`;

async function mergeSession(
	redis: Redis,
	key: string,
	updates: Partial<Session>,
	ttlSeconds: number
): Promise<boolean> {
	const merged = await redis.eval(MERGE_SESSION_SCRIPT, 1, key, JSON.stringify(updates), ttlSeconds);
	return merged === 1;
}

/**
 * Update session data and refresh its TTL
 */
export async function updateSession(
	redis: Redis,
	sessionId: string,
	updates: Partial<Omit<Session, 'createdAt'>>
): Promise<boolean> {
	return mergeSession(redis, sessionKey(sessionId), updates, SESSION_TTL_SECONDS);
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
 * Redis keys of every session belonging to a user. Sessions aren't indexed
 * by user, so this scans the whole keyspace; keep it to rare admin actions.
 */
async function userSessionKeys(redis: Redis, userId: string): Promise<string[]> {
	const found: string[] = [];
	let cursor = '0';
	do {
		const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', sessionKey('*'), 'COUNT', 100);
		cursor = nextCursor;
		for (const key of keys) {
			const data = await redis.get(key);
			if (!data) continue;
			let session: Session;
			try {
				session = JSON.parse(data);
			} catch {
				// Corrupted session data belongs to no one
				continue;
			}
			if (session.userId === userId) {
				found.push(key);
			}
		}
	} while (cursor !== '0');
	return found;
}

/**
 * Apply updates to every live session of a user, e.g. after an admin changes
 * their roles. The TTL is kept so an idle session's expiry isn't extended.
 */
export async function updateUserSessions(
	redis: Redis,
	userId: string,
	updates: Partial<Omit<Session, 'userId' | 'createdAt'>>
): Promise<void> {
	for (const key of await userSessionKeys(redis, userId)) {
		await mergeSession(redis, key, updates, 0);
	}
}

/**
 * Delete every session of a user, forcing re-login on all devices
 */
export async function deleteUserSessions(redis: Redis, userId: string): Promise<void> {
	for (const key of await userSessionKeys(redis, userId)) {
		await redis.del(key);
	}
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
