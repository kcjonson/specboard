/**
 * A full sync makes storage match the archive: files it synced stay, committed files it
 * no longer has go, and one it had but couldn't upload is kept rather than lost.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
	}),
}));

vi.mock('./shared/db-utils.ts', () => ({ updateSyncStatus: vi.fn(async () => {}) }));

vi.mock('./zip-stream.ts', () => ({
	streamGitHubZipToStorage: vi.fn(),
	getHeadCommitSha: vi.fn(async () => 'head'),
}));

import { performInitialSync } from './initial-sync.ts';
import { streamGitHubZipToStorage } from './zip-stream.ts';
import { updateSyncStatus } from './shared/db-utils.ts';

const PARAMS = { projectId: 'p1', owner: 'acme', repo: 'docs', branch: 'main', token: 't' };

beforeEach(() => {
	vi.clearAllMocks();
	storage.files = new Set(['docs/kept.md', 'docs/gone.md', 'docs/failed.md', 'docs/renamed-away.md']);
});

describe('performInitialSync', () => {
	it('removes committed files the archive no longer has', async () => {
		vi.mocked(streamGitHubZipToStorage).mockResolvedValue({
			synced: 2,
			skipped: 1,
			errors: ['Failed to sync docs/failed.md: 500'],
			commitSha: 'head',
			kept: new Set(['docs/kept.md', 'docs/renamed-to.md', 'docs/failed.md']),
		});

		const result = await performInitialSync(PARAMS, 'http://storage', 'key');

		expect(result).toMatchObject({ success: true, pruned: 2, commitSha: 'head' });
		expect(storage.deleteFile.mock.calls.map((call) => call[1]).sort()).toEqual(['docs/gone.md', 'docs/renamed-away.md']);
		expect([...storage.files].sort()).toEqual(['docs/failed.md', 'docs/kept.md']);
		expect(updateSyncStatus).toHaveBeenLastCalledWith('p1', 'completed', 'head');
	});

	it('prunes nothing when the archive could not be read', async () => {
		vi.mocked(streamGitHubZipToStorage).mockRejectedValue(new Error('GitHub API error: 502 Bad Gateway'));

		const result = await performInitialSync(PARAMS, 'http://storage', 'key');

		expect(result).toMatchObject({ success: false, pruned: 0 });
		expect(storage.deleteFile).not.toHaveBeenCalled();
		expect(updateSyncStatus).toHaveBeenLastCalledWith('p1', 'failed', null, 'GitHub API error: 502 Bad Gateway');
	});
});
