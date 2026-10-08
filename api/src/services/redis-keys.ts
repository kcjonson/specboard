import type { Redis } from 'ioredis';

/**
 * Delete every key matching a glob. SCAN rather than KEYS, which blocks Redis for the
 * length of a walk over the whole keyspace.
 */
export async function deleteKeysMatching(redis: Redis, pattern: string): Promise<void> {
	let cursor = '0';
	do {
		const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
		cursor = nextCursor;
		if (keys.length > 0) await redis.del(...keys);
	} while (cursor !== '0');
}
