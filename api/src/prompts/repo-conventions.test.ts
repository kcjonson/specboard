import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isConventionFile, readRepoConventions, invalidateRepoConventions } from './repo-conventions.ts';
import type { StorageProvider } from '../services/storage/types.ts';
import type { Redis } from 'ioredis';

// Minimal mock Redis that tracks get/set/del calls
function createMockRedis(cache: Map<string, string> = new Map()): Redis {
	return {
		get: vi.fn(async (key: string) => cache.get(key) ?? null),
		set: vi.fn(async (key: string, value: string) => {
			cache.set(key, value);
			return 'OK';
		}),
		del: vi.fn(async (key: string) => {
			cache.delete(key);
			return 1;
		}),
	} as unknown as Redis;
}

// Minimal mock StorageProvider with configurable file contents
function createMockProvider(files: Record<string, string> = {}): StorageProvider {
	return {
		readFile: vi.fn(async (path: string) => {
			if (path in files) return files[path]!;
			throw new Error('File not found');
		}),
	} as unknown as StorageProvider;
}

describe('isConventionFile', () => {
	it('returns true for CLAUDE.md at root', () => {
		expect(isConventionFile('/CLAUDE.md')).toBe(true);
	});

	it('returns true for AGENT.md at root', () => {
		expect(isConventionFile('/AGENT.md')).toBe(true);
	});

	it('returns true for CLAUDE.md in subdirectory', () => {
		expect(isConventionFile('/docs/CLAUDE.md')).toBe(true);
	});

	it('returns false for regular markdown files', () => {
		expect(isConventionFile('/docs/readme.md')).toBe(false);
	});

	it('returns false for similarly named files', () => {
		expect(isConventionFile('/CLAUDE.txt')).toBe(false);
		expect(isConventionFile('/MY-CLAUDE.md')).toBe(false);
	});

	it('returns false for empty path', () => {
		expect(isConventionFile('')).toBe(false);
	});

	it('is case-sensitive', () => {
		expect(isConventionFile('/claude.md')).toBe(false);
		expect(isConventionFile('/agent.md')).toBe(false);
	});
});

describe('readRepoConventions', () => {
	let redis: Redis;

	beforeEach(() => {
		redis = createMockRedis();
	});

	it('returns cached value on cache hit', async () => {
		const cache = new Map([['project:proj1:user1:repo-prompt', 'cached conventions']]);
		redis = createMockRedis(cache);
		const provider = createMockProvider();

		const result = await readRepoConventions('proj1', 'user1', redis, provider);
		expect(result).toBe('cached conventions');
		// Should not read files when cache hit
		expect(provider.readFile).not.toHaveBeenCalled();
	});

	it('returns null on empty sentinel cache hit', async () => {
		const cache = new Map([['project:proj1:user1:repo-prompt', '__EMPTY__']]);
		redis = createMockRedis(cache);
		const provider = createMockProvider();

		const result = await readRepoConventions('proj1', 'user1', redis, provider);
		expect(result).toBeNull();
		expect(provider.readFile).not.toHaveBeenCalled();
	});

	it('reads files on cache miss and caches the result', async () => {
		const provider = createMockProvider({
			'/CLAUDE.md': '# Project conventions',
		});

		const result = await readRepoConventions('proj1', 'user1', redis, provider);
		expect(result).toBe('# Project conventions');
		expect(redis.set).toHaveBeenCalledWith(
			'project:proj1:user1:repo-prompt',
			'# Project conventions',
			'EX',
			300,
		);
	});

	it('concatenates CLAUDE.md and AGENT.md with separator', async () => {
		const provider = createMockProvider({
			'/CLAUDE.md': 'Claude rules',
			'/AGENT.md': 'Agent rules',
		});

		const result = await readRepoConventions('proj1', 'user1', redis, provider);
		expect(result).toBe('Claude rules\n---\nAgent rules');
	});

	it('returns null and caches empty sentinel when no files found', async () => {
		const provider = createMockProvider({}); // No convention files

		const result = await readRepoConventions('proj1', 'user1', redis, provider);
		expect(result).toBeNull();
		expect(redis.set).toHaveBeenCalledWith(
			'project:proj1:user1:repo-prompt',
			'__EMPTY__',
			'EX',
			120,
		);
	});

	it('returns null and caches empty sentinel when provider is null', async () => {
		const result = await readRepoConventions('proj1', 'user1', redis, null);
		expect(result).toBeNull();
		expect(redis.set).toHaveBeenCalledWith(
			'project:proj1:user1:repo-prompt',
			'__EMPTY__',
			'EX',
			120,
		);
	});

	it('strips control characters from result', async () => {
		const provider = createMockProvider({
			'/CLAUDE.md': 'Hello\x00\x01\x08\x0b\x0c\x0e\x1f\x7fWorld',
		});

		const result = await readRepoConventions('proj1', 'user1', redis, provider);
		expect(result).toBe('HelloWorld');
	});

	it('truncates total content to 20KB', async () => {
		const provider = createMockProvider({
			'/CLAUDE.md': 'a'.repeat(10_000),
			'/AGENT.md': 'b'.repeat(10_000),
		});

		const result = await readRepoConventions('proj1', 'user1', redis, provider);
		// 10000 + '\n---\n' (5 chars) + 10000 = 20005, should be truncated to 20000
		expect(result!.length).toBe(20_000);
	});

	it('truncates individual files to 10KB before concatenation', async () => {
		const provider = createMockProvider({
			'/CLAUDE.md': 'x'.repeat(15_000),
		});

		const result = await readRepoConventions('proj1', 'user1', redis, provider);
		// Single file should be truncated to 10000
		expect(result!.length).toBe(10_000);
	});

	it('scopes cache key by userId', async () => {
		const provider = createMockProvider({
			'/CLAUDE.md': 'content',
		});

		await readRepoConventions('proj1', 'userA', redis, provider);
		await readRepoConventions('proj1', 'userB', redis, provider);

		// Should have cached with different keys
		expect(redis.set).toHaveBeenCalledWith(
			'project:proj1:userA:repo-prompt',
			expect.any(String),
			'EX',
			300,
		);
		expect(redis.set).toHaveBeenCalledWith(
			'project:proj1:userB:repo-prompt',
			expect.any(String),
			'EX',
			300,
		);
	});

	it('degrades gracefully when Redis is unavailable', async () => {
		const failingRedis = {
			get: vi.fn(async () => { throw new Error('Connection refused'); }),
			set: vi.fn(async () => { throw new Error('Connection refused'); }),
			del: vi.fn(async () => { throw new Error('Connection refused'); }),
		} as unknown as Redis;
		const provider = createMockProvider({
			'/CLAUDE.md': 'content',
		});

		// Should still return content even though Redis failed
		const result = await readRepoConventions('proj1', 'user1', failingRedis, provider);
		expect(result).toBe('content');
	});
});

describe('invalidateRepoConventions', () => {
	it('deletes the correct cache key', async () => {
		const cache = new Map([['project:proj1:user1:repo-prompt', 'cached']]);
		const redis = createMockRedis(cache);

		await invalidateRepoConventions('proj1', 'user1', redis);
		expect(redis.del).toHaveBeenCalledWith('project:proj1:user1:repo-prompt');
	});

	it('degrades gracefully when Redis is unavailable', async () => {
		const failingRedis = {
			del: vi.fn(async () => { throw new Error('Connection refused'); }),
		} as unknown as Redis;

		// Should not throw
		await expect(invalidateRepoConventions('proj1', 'user1', failingRedis)).resolves.toBeUndefined();
	});
});
