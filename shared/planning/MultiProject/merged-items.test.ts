/**
 * MergedItems: several projects' collections read as one, interleaved round-robin
 * within each status, with everything that loads fanned out to each project, and a
 * project that answers 403 or 404 dropped from all of it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FetchError, fetchClient } from '@specboard/fetch';
import { ItemsCollection, type ItemStatus } from '@specboard/models';
import { MergedItems } from './merged-items';

vi.mock('@specboard/fetch', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@specboard/fetch')>();
	return {
		...actual,
		fetchClient: { get: vi.fn(), getResponse: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
	};
});

interface ServedProject {
	key: string;
	/** Rows per status; ranks are 1..n unless given. */
	counts?: Partial<Record<ItemStatus, number>>;
	/** The status every window request fails with, instead of answering. */
	failWith?: number;
}

let served: Record<string, ServedProject> = {};

/** Pages each project's windows the way the server does: `limit` rows plus the total. */
function serve(projects: Record<string, ServedProject>): void {
	served = projects;
	vi.mocked(fetchClient.getResponse).mockImplementation(async (url: string) => {
		const parsed = new URL(url, 'http://x');
		const ref = parsed.pathname.replace(/^\/api\/projects\//, '').replace(/\/items$/, '');
		const project = served[ref];
		if (!project) throw new Error(`Unexpected request ${url}`);
		if (project.failWith) throw new FetchError(`HTTP ${project.failWith}`, project.failWith);
		const status = parsed.searchParams.get('status') as ItemStatus;
		const limit = Number(parsed.searchParams.get('limit'));
		const total = project.counts?.[status] ?? 0;
		const data = Array.from({ length: Math.min(limit, total) }, (_, i) => ({
			id: `${project.key}-${status}-${i + 1}`,
			key: `${project.key}-${status === 'ready' ? '' : `${status}-`}${i + 1}`,
			status,
			type: 'task',
			rank: i + 1,
			title: `${project.key} ${status} ${i + 1}`,
			updatedAt: 't1',
		}));
		return { data, headers: new Headers({ 'X-Total-Count': String(total) }) };
	});
}

/** Requests made for one project, as URLs. */
function requestsFor(ref: string): string[] {
	return vi.mocked(fetchClient.getResponse).mock.calls
		.map(([url]) => url as string)
		.filter((url) => url.startsWith(`/api/projects/${ref}/items?`));
}

async function merged(...refs: string[]): Promise<MergedItems> {
	const items = new MergedItems(refs.map((projectRef) => new ItemsCollection({ projectRef, limit: 100 })));
	await items.fetch();
	return items;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('MergedItems order', () => {
	it('interleaves each status round-robin by each project\'s own order, ties going to selection order', async () => {
		serve({
			'acme/a': { key: 'A', counts: { ready: 3 } },
			'acme/b': { key: 'B', counts: { ready: 1 } },
			'acme/c': { key: 'C', counts: { ready: 2 } },
		});
		const items = await merged('acme/a', 'acme/b', 'acme/c');

		expect(items.byStatus('ready').map((item) => item.key)).toEqual(['A-1', 'B-1', 'C-1', 'A-2', 'C-2', 'A-3']);
	});

	it('follows the order the projects were chosen in, not anything about the projects', async () => {
		serve({
			'acme/a': { key: 'A', counts: { ready: 2 } },
			'acme/b': { key: 'B', counts: { ready: 2 } },
		});
		const items = await merged('acme/b', 'acme/a');

		expect(items.byStatus('ready').map((item) => item.key)).toEqual(['B-1', 'A-1', 'B-2', 'A-2']);
	});

	it('keeps each status to its own items, and leaves each item addressed to its own project', async () => {
		serve({
			'acme/a': { key: 'A', counts: { ready: 1, done: 1 } },
			'acme/b': { key: 'B', counts: { done: 1 } },
		});
		const items = await merged('acme/a', 'acme/b');

		expect(items.byStatus('done').map((item) => item.key)).toEqual(['A-done-1', 'B-done-1']);
		expect(items.byStatus('in_progress')).toEqual([]);
		expect(items.byStatus('done').map((item) => item.projectRef)).toEqual(['acme/a', 'acme/b']);
	});
});

describe('MergedItems counts', () => {
	it('adds up what is loaded and what each server holds, and has more while any project does', async () => {
		serve({
			'acme/a': { key: 'A', counts: { ready: 250 } },
			'acme/b': { key: 'B', counts: { ready: 5, done: 2 } },
		});
		const items = await merged('acme/a', 'acme/b');

		expect(items.loadedFor('ready')).toBe(105);
		expect(items.totalFor('ready')).toBe(255);
		expect(items.hasMore('ready')).toBe(true);
		expect(items.totalFor('done')).toBe(2);
		expect(items.hasMore('done')).toBe(false);
	});

	it('waits for every project before calling itself fetched, and moves its version when any one changes', async () => {
		serve({
			'acme/a': { key: 'A', counts: { ready: 1 } },
			'acme/b': { key: 'B', counts: { ready: 1 } },
		});
		const a = new ItemsCollection({ projectRef: 'acme/a', limit: 100 });
		await a.fetch();
		const b = new ItemsCollection({ projectRef: 'acme/b', limit: 100 });
		const items = new MergedItems([a, b]);
		expect(items.$meta.lastFetched).toBeNull();
		expect(items.$meta.working).toBe(true);

		const before = items.version;
		await b.fetch();
		expect(items.$meta.lastFetched).not.toBeNull();
		expect(items.$meta.working).toBe(false);
		expect(items.version).toBeGreaterThan(before);
	});

	it('tells a subscriber when any project changes, and stops when it unsubscribes', async () => {
		serve({
			'acme/a': { key: 'A', counts: { ready: 1 } },
			'acme/b': { key: 'B', counts: { ready: 1 } },
		});
		const items = await merged('acme/a', 'acme/b');
		const listener = vi.fn();
		items.on('change', listener);

		await items.fetch({ force: true });
		const heard = listener.mock.calls.length;
		expect(heard).toBeGreaterThan(0);

		items.off('change', listener);
		await items.fetch({ force: true });
		expect(listener).toHaveBeenCalledTimes(heard);
	});
});

describe('MergedItems loading', () => {
	it('widens the window only of the projects with more in that status', async () => {
		serve({
			'acme/a': { key: 'A', counts: { ready: 250 } },
			'acme/b': { key: 'B', counts: { ready: 5 } },
		});
		const items = await merged('acme/a', 'acme/b');
		vi.mocked(fetchClient.getResponse).mockClear();

		await items.loadMore('ready', 100);

		expect(requestsFor('acme/a')).toContain('/api/projects/acme/a/items?status=ready&limit=201');
		expect(requestsFor('acme/b')).toEqual([]);
		expect(items.loadedFor('ready')).toBe(205);
	});

	it('applies a filter to every project', async () => {
		serve({
			'acme/a': { key: 'A', counts: { ready: 2 } },
			'acme/b': { key: 'B', counts: { ready: 2 } },
		});
		const items = await merged('acme/a', 'acme/b');
		expect(items.filterActive).toBe(false);

		await items.setFilter({ search: 'auth', type: 'bug' });

		expect(requestsFor('acme/a')).toContain('/api/projects/acme/a/items?status=ready&limit=101&search=auth&type=bug');
		expect(requestsFor('acme/b')).toContain('/api/projects/acme/b/items?status=ready&limit=101&search=auth&type=bug');
		expect(items.filterActive).toBe(true);
	});

	it('refetches every project', async () => {
		serve({
			'acme/a': { key: 'A' },
			'acme/b': { key: 'B' },
		});
		const items = await merged('acme/a', 'acme/b');
		vi.mocked(fetchClient.getResponse).mockClear();

		await items.fetch();

		expect(requestsFor('acme/a')).toHaveLength(5);
		expect(requestsFor('acme/b')).toHaveLength(5);
	});
});

describe('MergedItems failures', () => {
	it.each([403, 404])('drops a project that answers %i, and stops asking it', async (status) => {
		serve({
			'acme/a': { key: 'A', counts: { ready: 2 } },
			'acme/gone': { key: 'G', failWith: status },
			'acme/c': { key: 'C', counts: { ready: 1 } },
		});
		const items = await merged('acme/a', 'acme/gone', 'acme/c');

		expect(items.dropped).toEqual(['acme/gone']);
		expect(items.$meta.error).toBeNull();
		expect(items.$meta.lastFetched).not.toBeNull();
		expect(items.byStatus('ready').map((item) => item.key)).toEqual(['A-1', 'C-1', 'A-2']);
		expect(items.totalFor('ready')).toBe(3);

		vi.mocked(fetchClient.getResponse).mockClear();
		await items.fetch();
		await items.setFilter({ search: 'auth' });
		await items.loadMore('ready', 100);
		expect(requestsFor('acme/gone')).toEqual([]);
		expect(requestsFor('acme/a').length).toBeGreaterThan(0);
	});

	it('drops a project that stops answering mid-session, keeping the rest', async () => {
		serve({
			'acme/a': { key: 'A', counts: { ready: 1 } },
			'acme/b': { key: 'B', counts: { ready: 1 } },
		});
		const items = await merged('acme/a', 'acme/b');

		served['acme/b'] = { key: 'B', failWith: 403 };
		await items.fetch();

		expect(items.dropped).toEqual(['acme/b']);
		expect(items.byStatus('ready').map((item) => item.key)).toEqual(['A-1']);
	});

	it('holds any other failure as an error of the whole, without dropping the project', async () => {
		serve({
			'acme/a': { key: 'A', counts: { ready: 1 } },
			'acme/b': { key: 'B', failWith: 500 },
		});
		const items = await merged('acme/a', 'acme/b');

		expect(items.dropped).toEqual([]);
		expect(items.$meta.error).toBeInstanceOf(FetchError);
		expect((items.$meta.error as FetchError).status).toBe(500);

		served['acme/b'] = { key: 'B', counts: { ready: 1 } };
		await items.fetch({ force: true });
		expect(items.$meta.error).toBeNull();
		expect(items.byStatus('ready').map((item) => item.key)).toEqual(['A-1', 'B-1']);
	});
});
