/**
 * @specboard/models - SyncCollection tests
 *
 * Focused on `version`: the counter that lets memoized derived state (e.g. the
 * planning board's status grouping) recompute on in-place mutations even though
 * the collection reference is stable. Regression guard for the board bug where
 * newly-created items / status changes didn't appear until a page reload.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncCollection } from './SyncCollection';
import { SyncModel } from './SyncModel';
import { prop } from './prop';
import { fetchClient } from '@specboard/fetch';

vi.mock('@specboard/fetch', () => ({
	fetchClient: {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

class Task extends SyncModel {
	static url = '/api/tasks/:id';

	@prop accessor id!: number;
	@prop accessor status!: string;
}

class Tasks extends SyncCollection<Task> {
	static url = '/api/tasks';
	static Model = Task;
}

describe('SyncCollection version', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('increments on add', async () => {
		const tasks = new Tasks({});
		const before = tasks.version;

		vi.mocked(fetchClient.post).mockResolvedValue({ id: 1, status: 'ready' });
		await tasks.add({ status: 'ready' });

		expect(tasks.version).toBeGreaterThan(before);
	});

	it('increments when a child item mutates in place (change bubbles up)', async () => {
		const tasks = new Tasks({});
		vi.mocked(fetchClient.post).mockResolvedValue({ id: 1, status: 'ready' });
		const task = await tasks.add({ status: 'ready' });

		const before = tasks.version;
		task.status = 'done';

		expect(tasks.version).toBeGreaterThan(before);
	});

	it('increments on remove', async () => {
		const tasks = new Tasks({});
		vi.mocked(fetchClient.post).mockResolvedValue({ id: 1, status: 'ready' });
		const task = await tasks.add({ status: 'ready' });

		const before = tasks.version;
		vi.mocked(fetchClient.delete).mockResolvedValue(undefined);
		await tasks.remove(task);

		expect(tasks.version).toBeGreaterThan(before);
	});
});
