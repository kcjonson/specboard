/**
 * A full sync resolves the branch head to its full SHA, syncs that commit's archive,
 * makes storage match it (committed files the archive no longer has go), and stores
 * that same full SHA as the sync point, under the sync lock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const LOCK = new Date('2026-10-08T12:00:00.000Z');

const storage = vi.hoisted(() => ({
	files: new Set<string>(),
	putFile: vi.fn(async () => {}),
	deleteFile: vi.fn(async (_projectId: string, path: string) => {
		storage.files.delete(path);
	}),
}));

vi.mock('./shared/storage-client.ts', () => ({
	createStorageClient: () => ({
		putFile: storage.putFile,
		deleteFile: storage.deleteFile,
		listFiles: async () => [...storage.files],
		markUnavailable: vi.fn(async () => {}),
	}),
}));

vi.mock('./shared/db-utils.ts', () => ({
	markSyncing: vi.fn(),
	markSyncFailed: vi.fn(async () => {}),
	completeSync: vi.fn(async () => true),
}));

vi.mock('./zip-stream.ts', () => ({
	streamGitHubZipToStorage: vi.fn(),
	getHeadCommitSha: vi.fn(async () => HEAD),
}));

import { performInitialSync, SUPERSEDED } from './initial-sync.ts';
import { streamGitHubZipToStorage } from './zip-stream.ts';
import { completeSync, markSyncFailed, markSyncing } from './shared/db-utils.ts';

const PENDING = new Date('2026-10-08T11:59:00.000Z');
const PARAMS = { projectId: 'p1', owner: 'acme', repo: 'docs', branch: 'main', token: 't', lockToken: PENDING };

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(markSyncing).mockResolvedValue(LOCK);
	storage.files = new Set(['docs/kept.md', 'docs/gone.md', 'docs/skipped.png', 'docs/renamed-away.md']);
});

describe('performInitialSync', () => {
	it('syncs the head commit\'s archive, prunes what it lacks, and stores the full SHA', async () => {
		vi.mocked(streamGitHubZipToStorage).mockResolvedValue({
			synced: 2,
			skipped: 1,
			errors: [],
			kept: new Set(['docs/kept.md', 'docs/renamed-to.md', 'docs/skipped.png']),
		});

		const result = await performInitialSync(PARAMS, 'http://storage', 'key');

		expect(result).toMatchObject({ success: true, pruned: 2, commitSha: HEAD });
		expect(markSyncing).toHaveBeenCalledWith('p1', PENDING);
		expect(vi.mocked(streamGitHubZipToStorage).mock.calls[0]![2]).toBe(HEAD);
		expect(storage.deleteFile.mock.calls.map((call) => call[1]).sort()).toEqual(['docs/gone.md', 'docs/renamed-away.md']);
		expect(completeSync).toHaveBeenCalledWith('p1', LOCK, undefined, HEAD, { renamed: [], deleted: [] });
		expect(vi.mocked(completeSync).mock.calls[0]![3]).toMatch(/^[0-9a-f]{40}$/);
	});

	it('fails without pruning or moving the sync point when a file didn\'t make it in', async () => {
		vi.mocked(streamGitHubZipToStorage).mockResolvedValue({
			synced: 1,
			skipped: 0,
			errors: ['Failed to sync docs/gone.md: 500: storage unavailable'],
			kept: new Set(['docs/kept.md']),
		});

		const result = await performInitialSync(PARAMS, 'http://storage', 'key');

		expect(result).toMatchObject({ success: false });
		expect(result.error).toContain('docs/gone.md');
		expect(storage.deleteFile).not.toHaveBeenCalled();
		expect(completeSync).not.toHaveBeenCalled();
		expect(markSyncFailed).toHaveBeenCalled();
	});

	it('prunes nothing and records the failure when the archive can\'t be read', async () => {
		vi.mocked(streamGitHubZipToStorage).mockRejectedValue(new Error('GitHub API error: 502 Bad Gateway'));

		const result = await performInitialSync(PARAMS, 'http://storage', 'key');

		expect(result).toMatchObject({ success: false, pruned: 0 });
		expect(storage.deleteFile).not.toHaveBeenCalled();
		expect(markSyncFailed).toHaveBeenCalledWith('p1', LOCK, 'GitHub API error: 502 Bad Gateway');
		expect(completeSync).not.toHaveBeenCalled();
	});

	it('does nothing when the lock isn\'t its to take', async () => {
		vi.mocked(markSyncing).mockResolvedValue(null);

		expect(await performInitialSync(PARAMS, 'http://storage', 'key')).toMatchObject({ success: false, error: SUPERSEDED });
		expect(streamGitHubZipToStorage).not.toHaveBeenCalled();
	});
});
