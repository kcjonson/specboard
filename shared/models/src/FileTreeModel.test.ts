import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	FileTreeModel,
	getDepthForPath,
	expandedTreeToPaths,
	pathsToExpandedTree,
	addPathToTree,
	removePathFromTree,
} from './FileTreeModel';
import { fetchClient } from '@doc-platform/fetch';

// Mock fetchClient
vi.mock('@doc-platform/fetch', () => ({
	fetchClient: {
		post: vi.fn(),
	},
}));

// Mock localStorage
const localStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		clear: () => {
			store = {};
		},
	};
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('Tree conversion utilities', () => {
	describe('expandedTreeToPaths', () => {
		it('converts empty tree to empty array', () => {
			expect(expandedTreeToPaths({})).toEqual([]);
		});

		it('converts single level tree', () => {
			expect(expandedTreeToPaths({ docs: {} })).toEqual(['/docs']);
		});

		it('converts nested tree', () => {
			const tree = { docs: { nested: { deep: {} } }, other: {} };
			const paths = expandedTreeToPaths(tree);
			expect(paths).toContain('/docs');
			expect(paths).toContain('/docs/nested');
			expect(paths).toContain('/docs/nested/deep');
			expect(paths).toContain('/other');
		});
	});

	describe('pathsToExpandedTree', () => {
		it('converts empty array to empty tree', () => {
			expect(pathsToExpandedTree([])).toEqual({});
		});

		it('converts single path', () => {
			expect(pathsToExpandedTree(['/docs'])).toEqual({ docs: {} });
		});

		it('converts nested paths', () => {
			const paths = ['/docs', '/docs/nested', '/docs/nested/deep', '/other'];
			expect(pathsToExpandedTree(paths)).toEqual({
				docs: { nested: { deep: {} } },
				other: {},
			});
		});

		it('handles paths with shared prefixes', () => {
			const paths = ['/docs/a', '/docs/b'];
			expect(pathsToExpandedTree(paths)).toEqual({
				docs: { a: {}, b: {} },
			});
		});
	});

	describe('addPathToTree', () => {
		it('adds path to empty tree', () => {
			expect(addPathToTree({}, '/docs')).toEqual({ docs: {} });
		});

		it('adds nested path', () => {
			expect(addPathToTree({}, '/docs/nested')).toEqual({
				docs: { nested: {} },
			});
		});

		it('preserves existing paths', () => {
			const tree = { other: {} };
			expect(addPathToTree(tree, '/docs')).toEqual({
				docs: {},
				other: {},
			});
		});
	});

	describe('removePathFromTree', () => {
		it('removes path and descendants', () => {
			const tree = { docs: { nested: { deep: {} } }, other: {} };
			expect(removePathFromTree(tree, '/docs')).toEqual({ other: {} });
		});

		it('removes nested path', () => {
			const tree = { docs: { nested: { deep: {} }, file: {} } };
			expect(removePathFromTree(tree, '/docs/nested')).toEqual({
				docs: { file: {} },
			});
		});

		it('handles non-existent path', () => {
			const tree = { docs: {} };
			expect(removePathFromTree(tree, '/other')).toEqual({ docs: {} });
		});
	});
});

describe('FileTreeModel utilities', () => {
	describe('getDepthForPath', () => {
		it('returns 0 for root paths', () => {
			expect(getDepthForPath('/', ['/'])).toBe(0);
			expect(getDepthForPath('/docs', ['/docs'])).toBe(0);
		});

		it('returns correct depth for children', () => {
			expect(getDepthForPath('/docs', ['/'])).toBe(1);
			expect(getDepthForPath('/docs/nested', ['/'])).toBe(2);
		});

		it('handles non-root starting paths', () => {
			expect(getDepthForPath('/docs/nested', ['/docs'])).toBe(1);
			expect(getDepthForPath('/docs/nested/deep', ['/docs'])).toBe(2);
		});
	});
});

describe('FileTreeModel', () => {
	let model: FileTreeModel;
	const mockPost = fetchClient.post as ReturnType<typeof vi.fn>;

	beforeEach(() => {
		model = new FileTreeModel();
		mockPost.mockReset();
		localStorageMock.clear();
	});

	describe('initialize', () => {
		it('loads tree with single request', async () => {
			mockPost.mockResolvedValueOnce({
				files: [
					{ name: 'Root', path: '/', type: 'directory' },
					{ name: 'docs', path: '/docs', type: 'directory' },
				],
				expanded: {},
				rootPaths: ['/'],
			});

			await model.initialize('project-1');

			expect(model.projectId).toBe('project-1');
			expect(model.rootPaths).toEqual(['/']);
			expect(model.files).toHaveLength(2);
			expect(mockPost).toHaveBeenCalledTimes(1);
			expect(mockPost).toHaveBeenCalledWith(
				'/api/projects/project-1/tree',
				{ expanded: {} }
			);
		});

		it('sets error on failure', async () => {
			mockPost.mockRejectedValueOnce(new Error('Network error'));

			await model.initialize('project-1');

			expect(model.error).toBe('Failed to load files');
		});

		it('skips reload if same projectId', async () => {
			mockPost.mockResolvedValueOnce({
				files: [],
				expanded: {},
				rootPaths: ['/'],
			});

			await model.initialize('project-1');
			await model.initialize('project-1');

			expect(mockPost).toHaveBeenCalledTimes(1);
		});

		it('sends saved expanded tree from localStorage', async () => {
			localStorageMock.setItem(
				'fileBrowser.expanded',
				JSON.stringify({ 'project-1': { docs: {} } })
			);

			mockPost.mockResolvedValueOnce({
				files: [
					{ name: 'Root', path: '/', type: 'directory' },
					{ name: 'docs', path: '/docs', type: 'directory' },
					{ name: 'readme.md', path: '/docs/readme.md', type: 'file' },
				],
				expanded: { docs: {} },
				rootPaths: ['/'],
			});

			await model.initialize('project-1');

			expect(mockPost).toHaveBeenCalledWith(
				'/api/projects/project-1/tree',
				{ expanded: { docs: {} } }
			);
			expect(model.isExpanded('/docs')).toBe(true);
		});
	});

	describe('expandFolder', () => {
		beforeEach(async () => {
			mockPost.mockResolvedValueOnce({
				files: [
					{ name: 'Root', path: '/', type: 'directory' },
					{ name: 'docs', path: '/docs', type: 'directory' },
				],
				expanded: {},
				rootPaths: ['/'],
			});
			await model.initialize('project-1');
		});

		it('reloads tree with new expanded path', async () => {
			mockPost.mockResolvedValueOnce({
				files: [
					{ name: 'Root', path: '/', type: 'directory' },
					{ name: 'docs', path: '/docs', type: 'directory' },
					{ name: 'readme.md', path: '/docs/readme.md', type: 'file' },
				],
				expanded: { docs: {} },
				rootPaths: ['/'],
			});

			await model.expandFolder('/docs');

			expect(model.isExpanded('/docs')).toBe(true);
			expect(model.files.find((f) => f.path === '/docs/readme.md')).toBeDefined();
		});

		it('does nothing if already expanded', async () => {
			// Set up as already expanded
			mockPost.mockResolvedValueOnce({
				files: [],
				expanded: { docs: {} },
				rootPaths: ['/'],
			});
			await model.reload();

			const callCount = mockPost.mock.calls.length;
			await model.expandFolder('/docs');
			expect(mockPost.mock.calls.length).toBe(callCount);
		});
	});

	describe('collapseFolder', () => {
		beforeEach(async () => {
			mockPost.mockResolvedValueOnce({
				files: [
					{ name: 'Root', path: '/', type: 'directory' },
					{ name: 'docs', path: '/docs', type: 'directory' },
					{ name: 'nested', path: '/docs/nested', type: 'directory' },
					{ name: 'readme.md', path: '/docs/readme.md', type: 'file' },
				],
				expanded: { docs: {} },
				rootPaths: ['/'],
			});
			await model.initialize('project-1');
		});

		it('removes children from files', () => {
			model.collapseFolder('/docs');

			expect(model.isExpanded('/docs')).toBe(false);
			expect(model.files.find((f) => f.path === '/docs/readme.md')).toBeUndefined();
			expect(model.files.find((f) => f.path === '/docs')).toBeDefined();
		});

		it('removes nested expanded paths', async () => {
			// First expand nested
			mockPost.mockResolvedValueOnce({
				files: [
					{ name: 'Root', path: '/', type: 'directory' },
					{ name: 'docs', path: '/docs', type: 'directory' },
					{ name: 'nested', path: '/docs/nested', type: 'directory' },
					{ name: 'deep.md', path: '/docs/nested/deep.md', type: 'file' },
					{ name: 'readme.md', path: '/docs/readme.md', type: 'file' },
				],
				expanded: { docs: { nested: {} } },
				rootPaths: ['/'],
			});
			await model.expandFolder('/docs/nested');

			expect(model.isExpanded('/docs/nested')).toBe(true);

			model.collapseFolder('/docs');

			expect(model.isExpanded('/docs')).toBe(false);
			expect(model.isExpanded('/docs/nested')).toBe(false);
		});
	});

	describe('persistence', () => {
		it('saves expanded tree to localStorage after load', async () => {
			mockPost.mockResolvedValueOnce({
				files: [{ name: 'Root', path: '/', type: 'directory' }],
				expanded: { docs: {} },
				rootPaths: ['/'],
			});

			await model.initialize('project-1');

			const stored = JSON.parse(localStorageMock.getItem('fileBrowser.expanded')!);
			expect(stored['project-1']).toEqual({ docs: {} });
		});

		it('removes invalid paths from storage (server validates)', async () => {
			// Pre-save with a path that server will remove
			localStorageMock.setItem(
				'fileBrowser.expanded',
				JSON.stringify({ 'project-1': { docs: {}, 'deleted-folder': {} } })
			);

			// Server only returns valid paths
			mockPost.mockResolvedValueOnce({
				files: [{ name: 'Root', path: '/', type: 'directory' }],
				expanded: { docs: {} }, // deleted-folder not included
				rootPaths: ['/'],
			});

			await model.initialize('project-1');

			const stored = JSON.parse(localStorageMock.getItem('fileBrowser.expanded')!);
			expect(stored['project-1']).toEqual({ docs: {} });
			expect(stored['project-1']['deleted-folder']).toBeUndefined();
		});
	});

	describe('isRootPath', () => {
		beforeEach(async () => {
			mockPost.mockResolvedValueOnce({
				files: [],
				expanded: {},
				rootPaths: ['/docs', '/other'],
			});
			await model.initialize('project-1');
		});

		it('returns true for root paths', () => {
			expect(model.isRootPath('/docs')).toBe(true);
			expect(model.isRootPath('/other')).toBe(true);
		});

		it('returns false for non-root paths', () => {
			expect(model.isRootPath('/docs/nested')).toBe(false);
			expect(model.isRootPath('/')).toBe(false);
		});
	});

	describe('getDepth', () => {
		beforeEach(async () => {
			mockPost.mockResolvedValueOnce({
				files: [],
				expanded: {},
				rootPaths: ['/'],
			});
			await model.initialize('project-1');
		});

		it('returns correct depth', () => {
			expect(model.getDepth('/')).toBe(0);
			expect(model.getDepth('/docs')).toBe(1);
			expect(model.getDepth('/docs/nested')).toBe(2);
		});
	});
});
