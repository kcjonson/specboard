/**
 * Auto-read convention files (CLAUDE.md, AGENT.md) from project repositories
 *
 * Reads convention files from the repo root and caches them in Redis.
 * Cache is invalidated on pull/sync operations and file edits.
 */

import type { Redis } from 'ioredis';
import type { StorageProvider } from '../services/storage/types.ts';
import { getStorageProvider } from '../handlers/storage/utils.ts';

const CACHE_KEY_PREFIX = 'project:';
const CACHE_KEY_SUFFIX = ':repo-prompt';
const CACHE_TTL_SECONDS = 300; // 5 minutes
const EMPTY_SENTINEL_TTL_SECONDS = 120; // 2 minutes for "no files found"
const MAX_CONTENT_LENGTH = 20_000;
const EMPTY_SENTINEL = '__EMPTY__';

const CONVENTION_FILES = ['CLAUDE.md', 'AGENT.md'];

function cacheKey(projectId: string): string {
	return `${CACHE_KEY_PREFIX}${projectId}${CACHE_KEY_SUFFIX}`;
}

/**
 * Check if a file path matches a convention file name.
 * Used to trigger cache invalidation when convention files are edited.
 */
export function isConventionFile(filePath: string): boolean {
	const filename = filePath.split('/').pop();
	return filename !== undefined && CONVENTION_FILES.includes(filename);
}

/**
 * Read a single convention file, returning its trimmed content or null.
 * Uses direct readFile with error catching instead of exists() + readFile() to avoid TOCTOU.
 */
async function readConventionFile(provider: StorageProvider, filename: string): Promise<string | null> {
	try {
		const content = await provider.readFile(`/${filename}`);
		const trimmed = content.trim();
		return trimmed || null;
	} catch {
		return null;
	}
}

/**
 * Read convention files from a project's repository root.
 *
 * 1. Check Redis cache — return immediately if cached
 * 2. Get storage provider for the project
 * 3. Read CLAUDE.md and AGENT.md from repo root (in parallel)
 * 4. Concatenate found files, strip control chars, truncate to 20k chars
 * 5. Cache result in Redis with TTL
 *
 * Gracefully degrades if Redis is unavailable — reads files directly.
 */
export async function readRepoConventions(
	projectId: string,
	userId: string,
	redis: Redis,
	existingProvider?: StorageProvider | null
): Promise<string | null> {
	const key = cacheKey(projectId);

	// Check cache first (graceful on Redis failure)
	try {
		const cached = await redis.get(key);
		if (cached !== null) {
			return cached === EMPTY_SENTINEL ? null : cached;
		}
	} catch {
		// Redis unavailable — fall through to read files directly
	}

	// Get storage provider (use existing one if provided to avoid duplicate DB query)
	const provider = existingProvider !== undefined
		? existingProvider
		: await getStorageProvider(projectId, userId);
	if (!provider) {
		// No storage configured — cache empty sentinel briefly
		try {
			await redis.set(key, EMPTY_SENTINEL, 'EX', EMPTY_SENTINEL_TTL_SECONDS);
		} catch {
			// Redis unavailable — skip caching
		}
		return null;
	}

	// Read convention files in parallel
	const results = await Promise.all(
		CONVENTION_FILES.map(filename => readConventionFile(provider, filename))
	);
	const contents = results.filter((c): c is string => c !== null);

	if (contents.length === 0) {
		try {
			await redis.set(key, EMPTY_SENTINEL, 'EX', EMPTY_SENTINEL_TTL_SECONDS);
		} catch {
			// Redis unavailable — skip caching
		}
		return null;
	}

	// Concatenate, strip control characters, and truncate
	let result = contents.join('\n---\n');
	// eslint-disable-next-line no-control-regex
	result = result.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
	if (result.length > MAX_CONTENT_LENGTH) {
		result = result.slice(0, MAX_CONTENT_LENGTH);
	}

	try {
		await redis.set(key, result, 'EX', CACHE_TTL_SECONDS);
	} catch {
		// Redis unavailable — skip caching, content still returned
	}
	return result;
}

/**
 * Invalidate the cached repo conventions for a project.
 * Call this after pull/sync operations or convention file edits.
 */
export async function invalidateRepoConventions(
	projectId: string,
	redis: Redis
): Promise<void> {
	try {
		await redis.del(cacheKey(projectId));
	} catch {
		// Redis unavailable — cache will expire via TTL
	}
}
