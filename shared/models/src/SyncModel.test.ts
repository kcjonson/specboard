/**
 * @doc-platform/models - SyncModel tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncModel } from './SyncModel';
import { prop } from './prop';
import { fetchClient } from '@doc-platform/fetch';

// Mock fetchClient
vi.mock('@doc-platform/fetch', () => ({
	fetchClient: {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

// Test model
class Post extends SyncModel {
	static url = '/api/posts/:id';

	@prop accessor id!: number;
	@prop accessor title!: string;
	@prop accessor body!: string;
}

// Test model with custom idField
class Comment extends SyncModel {
	static url = '/api/comments/:commentId';
	static idField = 'commentId';

	@prop accessor commentId!: number;
	@prop accessor text!: string;
}

describe('SyncModel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('initialization', () => {
		it('should create instance with initial data', () => {
			const post = new Post({ id: 1, title: 'Test', body: 'Content' });

			expect(post.id).toBe(1);
			expect(post.title).toBe('Test');
			expect(post.body).toBe('Content');
		});

		it('should have $meta with correct initial values', () => {
			const post = new Post({ id: 1, title: 'Test', body: 'Content' });

			expect(post.$meta.working).toBe(false);
			expect(post.$meta.error).toBe(null);
			expect(post.$meta.lastFetched).toBe(null);
		});

		it('should auto-fetch when only ID is provided', () => {
			vi.mocked(fetchClient.get).mockResolvedValue({ id: 1, title: 'Fetched', body: 'Body' });

			new Post({ id: 1 });

			expect(fetchClient.get).toHaveBeenCalledWith('/api/posts/1');
		});

		it('should not auto-fetch when full data is provided', () => {
			new Post({ id: 1, title: 'Test', body: 'Content' });

			expect(fetchClient.get).not.toHaveBeenCalled();
		});
	});

	describe('fetch()', () => {
		it('should fetch data from API', async () => {
			const post = new Post({ id: 1, title: 'Old', body: 'Old body' });
			vi.mocked(fetchClient.get).mockResolvedValue({ id: 1, title: 'New', body: 'New body' });

			await post.fetch();

			expect(fetchClient.get).toHaveBeenCalledWith('/api/posts/1');
			expect(post.title).toBe('New');
			expect(post.body).toBe('New body');
		});

		it('should set working=true during fetch', async () => {
			const post = new Post({ id: 1, title: 'Test', body: 'Content' });
			let workingDuringFetch = false;

			vi.mocked(fetchClient.get).mockImplementation(async () => {
				workingDuringFetch = post.$meta.working;
				return { id: 1, title: 'New', body: 'Body' };
			});

			await post.fetch();

			expect(workingDuringFetch).toBe(true);
			expect(post.$meta.working).toBe(false);
		});

		it('should set lastFetched after successful fetch', async () => {
			const post = new Post({ id: 1, title: 'Test', body: 'Content' });
			vi.mocked(fetchClient.get).mockResolvedValue({ id: 1, title: 'New', body: 'Body' });

			const before = Date.now();
			await post.fetch();
			const after = Date.now();

			expect(post.$meta.lastFetched).toBeGreaterThanOrEqual(before);
			expect(post.$meta.lastFetched).toBeLessThanOrEqual(after);
		});

		it('should set error on fetch failure', async () => {
			const post = new Post({ id: 1, title: 'Test', body: 'Content' });
			const error = new Error('Network error');
			vi.mocked(fetchClient.get).mockRejectedValue(error);

			await expect(post.fetch()).rejects.toThrow('Network error');

			expect(post.$meta.error).toBe(error);
			expect(post.$meta.working).toBe(false);
		});
	});

	describe('save()', () => {
		it('should POST for new records (no ID)', async () => {
			const post = new Post({ title: 'New Post', body: 'Content' });
			vi.mocked(fetchClient.post).mockResolvedValue({ id: 123, title: 'New Post', body: 'Content' });

			await post.save();

			expect(fetchClient.post).toHaveBeenCalledWith('/api/posts', expect.objectContaining({
				title: 'New Post',
				body: 'Content',
			}));
			expect(post.id).toBe(123);
		});

		it('should PUT for existing records (has ID)', async () => {
			const post = new Post({ id: 1, title: 'Updated', body: 'Content' });
			vi.mocked(fetchClient.put).mockResolvedValue({ id: 1, title: 'Updated', body: 'Content' });

			await post.save();

			expect(fetchClient.put).toHaveBeenCalledWith('/api/posts/1', expect.objectContaining({
				id: 1,
				title: 'Updated',
			}));
		});

		it('should set working=true during save', async () => {
			const post = new Post({ id: 1, title: 'Test', body: 'Content' });
			let workingDuringSave = false;

			vi.mocked(fetchClient.put).mockImplementation(async () => {
				workingDuringSave = post.$meta.working;
				return { id: 1, title: 'Test', body: 'Content' };
			});

			await post.save();

			expect(workingDuringSave).toBe(true);
			expect(post.$meta.working).toBe(false);
		});

		it('should set error on save failure', async () => {
			const post = new Post({ id: 1, title: 'Test', body: 'Content' });
			const error = new Error('Save failed');
			vi.mocked(fetchClient.put).mockRejectedValue(error);

			await expect(post.save()).rejects.toThrow('Save failed');

			expect(post.$meta.error).toBe(error);
		});
	});

	describe('delete()', () => {
		it('should DELETE the record', async () => {
			vi.mocked(fetchClient.delete).mockResolvedValue(undefined);

			const post = new Post({ id: 1, title: 'Test', body: 'Content' });
			await post.delete();

			expect(fetchClient.delete).toHaveBeenCalledWith('/api/posts/1');
		});

		it('should set working=true during delete', async () => {
			const post = new Post({ id: 1, title: 'Test', body: 'Content' });
			let workingDuringDelete = false;

			vi.mocked(fetchClient.delete).mockImplementation(async () => {
				workingDuringDelete = post.$meta.working;
				return undefined;
			});

			await post.delete();

			expect(workingDuringDelete).toBe(true);
			expect(post.$meta.working).toBe(false);
		});

		it('should set error on delete failure', async () => {
			const post = new Post({ id: 1, title: 'Test', body: 'Content' });
			const error = new Error('Delete failed');

			vi.mocked(fetchClient.delete).mockRejectedValue(error);

			await expect(post.delete()).rejects.toThrow('Delete failed');

			expect(post.$meta.error).toBe(error);
		});
	});

	describe('custom idField', () => {
		it('should use custom idField for determining POST vs PUT', async () => {
			const comment = new Comment({ text: 'New comment' });
			vi.mocked(fetchClient.post).mockResolvedValue({ commentId: 456, text: 'New comment' });

			await comment.save();

			expect(fetchClient.post).toHaveBeenCalled();
			expect(comment.commentId).toBe(456);
		});
	});

	describe('URL building', () => {
		it('should throw if no URL is set', async () => {
			class NoUrl extends SyncModel {
				@prop accessor id!: number;
				@prop accessor name!: string;
			}

			// Include name so auto-fetch doesn't trigger
			const model = new NoUrl({ id: 1, name: 'test' });

			await expect(model.fetch()).rejects.toThrow('has no URL');
		});

		it('should use instance data for URL template', async () => {
			vi.mocked(fetchClient.get).mockResolvedValue({ id: 42, title: 'Test', body: 'Content' });

			new Post({ id: 42 });

			// Wait for auto-fetch
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(fetchClient.get).toHaveBeenCalledWith('/api/posts/42');
		});
	});
});
