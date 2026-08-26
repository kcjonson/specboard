/**
 * CloudStorageProvider tests — pending-change journal semantics.
 *
 * The journal must reflect real differences from the committed tree: writing
 * committed content back clears the entry, deleting a never-committed file
 * discards its creation, and listings include pending creations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = {
	listFiles: vi.fn(),
	getFile: vi.fn(),
	listPendingChanges: vi.fn(),
	getPendingChange: vi.fn(),
	putPendingChange: vi.fn(),
	deletePendingChange: vi.fn(),
};

vi.mock('./storage-client.ts', () => ({
	getStorageClient: () => mockClient,
}));

import { CloudStorageProvider } from './cloud-provider.ts';

function provider(): CloudStorageProvider {
	return new CloudStorageProvider('project-1', 'user-1');
}

beforeEach(() => {
	vi.resetAllMocks();
	mockClient.listFiles.mockResolvedValue([]);
	mockClient.listPendingChanges.mockResolvedValue([]);
	mockClient.getFile.mockResolvedValue(null);
	mockClient.getPendingChange.mockResolvedValue(null);
});

describe('writeFile', () => {
	it('records a modified change when content differs from committed', async () => {
		mockClient.getFile.mockResolvedValue({ path: 'a.md', content: 'old' });

		await provider().writeFile('/a.md', 'new');

		expect(mockClient.putPendingChange).toHaveBeenCalledWith(
			'project-1', 'user-1', 'a.md', 'new', 'modified'
		);
	});

	it('records a created change for a file with no committed version', async () => {
		mockClient.getFile.mockResolvedValue(null);

		await provider().writeFile('/a.md', 'new');

		expect(mockClient.putPendingChange).toHaveBeenCalledWith(
			'project-1', 'user-1', 'a.md', 'new', 'created'
		);
	});

	it('clears the pending change when content matches committed', async () => {
		mockClient.getFile.mockResolvedValue({ path: 'a.md', content: 'same' });

		await provider().writeFile('/a.md', 'same');

		expect(mockClient.putPendingChange).not.toHaveBeenCalled();
		expect(mockClient.deletePendingChange).toHaveBeenCalledWith('project-1', 'user-1', 'a.md');
	});
});

describe('deleteFile', () => {
	it('records a deletion for a committed file', async () => {
		mockClient.getFile.mockResolvedValue({ path: 'a.md', content: 'x' });

		await provider().deleteFile('/a.md');

		expect(mockClient.putPendingChange).toHaveBeenCalledWith(
			'project-1', 'user-1', 'a.md', null, 'deleted'
		);
	});

	it('discards the pending creation for a never-committed file', async () => {
		mockClient.getFile.mockResolvedValue(null);

		await provider().deleteFile('/a.md');

		expect(mockClient.putPendingChange).not.toHaveBeenCalled();
		expect(mockClient.deletePendingChange).toHaveBeenCalledWith('project-1', 'user-1', 'a.md');
	});
});

describe('rename', () => {
	it('renaming back to the committed path leaves a clean journal', async () => {
		// a.md is committed; it was renamed to b.md earlier (pending: b.md created,
		// a.md deleted). Renaming b.md back to a.md must clear both entries.
		mockClient.getPendingChange.mockImplementation((_p, _u, path) =>
			path === 'b.md'
				? Promise.resolve({ path: 'b.md', content: 'committed', action: 'created', updatedAt: 'now' })
				: Promise.resolve(null)
		);
		mockClient.getFile.mockImplementation((_p, path) =>
			path === 'a.md'
				? Promise.resolve({ path: 'a.md', content: 'committed' })
				: Promise.resolve(null)
		);

		await provider().rename('/b.md', '/a.md');

		expect(mockClient.putPendingChange).not.toHaveBeenCalled();
		expect(mockClient.deletePendingChange).toHaveBeenCalledWith('project-1', 'user-1', 'a.md');
		expect(mockClient.deletePendingChange).toHaveBeenCalledWith('project-1', 'user-1', 'b.md');
	});

	it('renaming a committed file journals a creation and a deletion', async () => {
		mockClient.getFile.mockImplementation((_p, path) =>
			path === 'a.md'
				? Promise.resolve({ path: 'a.md', content: 'content' })
				: Promise.resolve(null)
		);

		await provider().rename('/a.md', '/b.md');

		expect(mockClient.putPendingChange).toHaveBeenCalledWith(
			'project-1', 'user-1', 'b.md', 'content', 'created'
		);
		expect(mockClient.putPendingChange).toHaveBeenCalledWith(
			'project-1', 'user-1', 'a.md', null, 'deleted'
		);
	});
});

describe('listDirectory', () => {
	it('includes pending creations alongside committed files', async () => {
		mockClient.listFiles.mockResolvedValue([
			{ path: 'a.md', contentHash: 'h', sizeBytes: 5, syncedAt: '2026-01-01T00:00:00Z' },
		]);
		mockClient.listPendingChanges.mockResolvedValue([
			{ path: 'b.md', action: 'created', hasContent: true, isLarge: false, updatedAt: '2026-01-02T00:00:00Z' },
			{ path: 'a.md', action: 'deleted', hasContent: false, isLarge: false, updatedAt: '2026-01-02T00:00:00Z' },
		]);

		const entries = await provider().listDirectory('/');

		const names = entries.map((e) => e.name).sort();
		// a.md stays listed while its deletion is pending (the tree strikes it
		// through from git status); b.md appears even though it is uncommitted.
		expect(names).toEqual(['a.md', 'b.md']);
	});
});
