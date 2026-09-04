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
import { Model } from './Model';
import { prop } from './prop';
import { collection } from './collection-decorator';
import type { Collection } from './Collection';
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

/** A model carrying the default `updatedAt` change key, for reconcile tests. */
class Doc extends SyncModel {
	static url = '/api/docs/:id';

	@prop accessor id!: number;
	@prop accessor title!: string;
	@prop accessor updatedAt!: string;
}

class Docs extends SyncCollection<Doc> {
	static url = '/api/docs';
	static Model = Doc;
}

/** A branch-like model identified by `name`, not `id`. */
class Branch extends SyncModel {
	static override url = '';
	static override idField = 'name';

	@prop accessor name!: string;
}

class Branches extends SyncCollection<Branch> {
	static url = '/api/branches';
	static Model = Branch;
}

class Child extends Model {
	@prop accessor id!: number;
	@prop accessor label!: string;
}

/** A model with a lazily-loaded nested collection (like an item's children). */
class Parent extends SyncModel {
	static url = '/api/parents/:id';

	@prop accessor id!: number;
	@prop accessor updatedAt!: string;
	@collection(Child) accessor children!: Collection<Child>;
}

class Parents extends SyncCollection<Parent> {
	static url = '/api/parents';
	static Model = Parent;
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

describe('SyncCollection reconciling fetch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('preserves model identity across a refetch (reuses instances by id)', async () => {
		vi.mocked(fetchClient.get).mockResolvedValue([{ id: 1, title: 'a', updatedAt: 't1' }]);
		const docs = new Docs({});
		await docs.fetch();
		const first = docs.toArray()[0];

		vi.mocked(fetchClient.get).mockResolvedValue([{ id: 1, title: 'a2', updatedAt: 't2' }]);
		await docs.fetch();

		expect(docs.toArray()[0]).toBe(first); // same instance
		expect(first!.title).toBe('a2'); // updated in place
	});

	it('reports changed ids via itemsChanged when updatedAt moves', async () => {
		vi.mocked(fetchClient.get).mockResolvedValue([
			{ id: 1, title: 'a', updatedAt: 't1' },
			{ id: 2, title: 'b', updatedAt: 't1' },
		]);
		const docs = new Docs({});
		await docs.fetch();

		const events: string[][] = [];
		docs.onItemsChanged((ids) => events.push(ids));

		vi.mocked(fetchClient.get).mockResolvedValue([
			{ id: 1, title: 'a', updatedAt: 't1' }, // unchanged
			{ id: 2, title: 'b2', updatedAt: 't2' }, // changed
		]);
		await docs.fetch();

		expect(events).toEqual([['2']]);
	});

	it('does not emit itemsChanged on the initial load', async () => {
		vi.mocked(fetchClient.get).mockResolvedValue([{ id: 1, title: 'a', updatedAt: 't1' }]);
		const docs = new Docs({});
		const events: string[][] = [];
		docs.onItemsChanged((ids) => events.push(ids));
		await docs.fetch();

		expect(events).toEqual([]);
	});

	it('reports newly added ids and drops removed ones on refetch', async () => {
		vi.mocked(fetchClient.get).mockResolvedValue([
			{ id: 1, title: 'a', updatedAt: 't1' },
			{ id: 2, title: 'b', updatedAt: 't1' },
		]);
		const docs = new Docs({});
		await docs.fetch();

		const events: string[][] = [];
		docs.onItemsChanged((ids) => events.push(ids));

		vi.mocked(fetchClient.get).mockResolvedValue([
			{ id: 1, title: 'a', updatedAt: 't1' },
			{ id: 3, title: 'c', updatedAt: 't1' }, // added; 2 removed
		]);
		await docs.fetch();

		expect(docs.length).toBe(2);
		expect(docs.toArray().map((d) => d.id).sort()).toEqual([1, 3]);
		expect(events).toEqual([['3']]);
	});

	it('reconciles by a non-default idField without collapsing rows', async () => {
		vi.mocked(fetchClient.get).mockResolvedValue([{ name: 'main' }, { name: 'dev' }]);
		const branches = new Branches({});
		await branches.fetch();
		const main = branches.toArray().find((b) => b.name === 'main');

		vi.mocked(fetchClient.get).mockResolvedValue([{ name: 'main' }, { name: 'dev' }, { name: 'feat' }]);
		await branches.fetch();

		expect(branches.toArray().map((b) => b.name)).toEqual(['main', 'dev', 'feat']);
		expect(branches.toArray().find((b) => b.name === 'main')).toBe(main); // not collapsed
	});

	it('does not clobber lazily-loaded nested collections on a changed item', async () => {
		vi.mocked(fetchClient.get).mockResolvedValue([{ id: 1, updatedAt: 't1', children: [] }]);
		const parents = new Parents({});
		await parents.fetch();
		const parent = parents.toArray()[0]!;
		parent.set({ children: [{ id: 10, label: 'x' }] }); // simulate a detail load
		expect(parent.children.length).toBe(1);

		// Poll returns the summary payload (children: []) with a bumped updatedAt.
		vi.mocked(fetchClient.get).mockResolvedValue([{ id: 1, updatedAt: 't2', children: [] }]);
		await parents.fetch();

		expect(parents.toArray()[0]).toBe(parent);
		expect(parent.children.length).toBe(1); // preserved, not wiped
	});

	it('coalesces concurrent fetches into a single request', async () => {
		vi.mocked(fetchClient.get).mockResolvedValue([{ id: 1, title: 'a', updatedAt: 't1' }]);
		const docs = new Docs({});
		await docs.fetch();

		vi.mocked(fetchClient.get).mockClear();
		vi.mocked(fetchClient.get).mockResolvedValue([{ id: 1, title: 'a', updatedAt: 't1' }]);
		await Promise.all([docs.fetch(), docs.fetch(), docs.fetch()]);

		expect(fetchClient.get).toHaveBeenCalledTimes(1);
	});

	// A refetch issued after a write must not coalesce onto a request the server
	// answered before that write — the reconcile would drop the new row.
	it('force starts a fresh request after the in-flight one and keeps its result', async () => {
		let releaseFirst: (rows: Array<Record<string, unknown>>) => void = () => {};
		const first = new Promise<Array<Record<string, unknown>>>((resolve) => {
			releaseFirst = resolve;
		});
		vi.mocked(fetchClient.get).mockImplementationOnce(() => first as never);

		const docs = new Docs({}); // constructor fetch is the slow one
		const stale = docs.fetch(); // coalesces onto it

		vi.mocked(fetchClient.get).mockResolvedValue([
			{ id: 1, title: 'a', updatedAt: 't1' },
			{ id: 2, title: 'b', updatedAt: 't1' },
		]);
		const forced = docs.fetch({ force: true });

		releaseFirst([{ id: 1, title: 'a', updatedAt: 't1' }]);
		await Promise.all([stale, forced]);

		expect(fetchClient.get).toHaveBeenCalledTimes(2);
		expect(docs.toArray().map((doc) => doc.id)).toEqual([1, 2]);
	});

	it('still coalesces when force is not set', async () => {
		vi.mocked(fetchClient.get).mockResolvedValue([{ id: 1, title: 'a', updatedAt: 't1' }]);
		const docs = new Docs({});
		await docs.fetch();

		vi.mocked(fetchClient.get).mockClear();
		await Promise.all([docs.fetch(), docs.fetch({ force: false })]);

		expect(fetchClient.get).toHaveBeenCalledTimes(1);
	});
});
