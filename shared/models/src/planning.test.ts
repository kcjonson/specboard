/**
 * @specboard/models - ItemsCollection tests
 *
 * The collection loads one bounded window per status and reports what the server
 * holds past each; these cover the window arithmetic and what a refetch keeps.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchClient } from '@specboard/fetch';
import { ItemsCollection, ITEM_STATUSES, type ItemStatus } from './planning';

vi.mock('@specboard/fetch', () => ({
	fetchClient: {
		get: vi.fn(),
		getResponse: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

type Row = Record<string, unknown>;

function row(status: ItemStatus, n: number, rank = n): Row {
	return { id: `id-${status}-${n}`, key: `SB-${status}-${n}`, status, rank, title: `${status} ${n}`, updatedAt: 't1' };
}

/** Rows 1..count for a status, as the server would page them: `limit` of them plus the total. */
function serve(counts: Partial<Record<ItemStatus, number>>): void {
	vi.mocked(fetchClient.getResponse).mockImplementation(async (url: string) => {
		const params = new URL(url, 'http://x').searchParams;
		const status = params.get('status') as ItemStatus;
		const limit = Number(params.get('limit'));
		const total = counts[status] ?? 0;
		const data = Array.from({ length: Math.min(limit, total) }, (_, i) => row(status, i + 1));
		return { data, headers: new Headers({ 'X-Total-Count': String(total) }) };
	});
}

function requestedLimit(status: ItemStatus): number | undefined {
	const calls = vi.mocked(fetchClient.getResponse).mock.calls.map(([url]) => url as string);
	const last = calls.filter((url) => url.includes(`status=${status}&`)).at(-1);
	return last ? Number(new URL(last, 'http://x').searchParams.get('limit')) : undefined;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('ItemsCollection windows', () => {
	it('requests one window per status, one row past the limit', async () => {
		serve({ ready: 5 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();

		expect(fetchClient.getResponse).toHaveBeenCalledTimes(ITEM_STATUSES.length);
		expect(fetchClient.getResponse).toHaveBeenCalledWith('/api/projects/demo/items?status=ready&limit=101');
	});

	it('shows the first `limit` rows and reports the rest from the total header', async () => {
		serve({ ready: 250, done: 3 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();

		expect(items.byStatus('ready')).toHaveLength(100);
		expect(items.totalFor('ready')).toBe(250);
		expect(items.hasMore('ready')).toBe(true);
		expect(items.totalFor('done')).toBe(3);
		expect(items.hasMore('done')).toBe(false);
		expect(items.hasMore('in_progress')).toBe(false);
	});

	it('loadMore widens one status window and refetches without flashing the new rows', async () => {
		serve({ ready: 250 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();
		const events: string[][] = [];
		items.onItemsChanged((ids) => events.push(ids));

		await items.loadMore('ready', 100);

		expect(requestedLimit('ready')).toBe(201);
		expect(requestedLimit('done')).toBe(101);
		expect(items.byStatus('ready')).toHaveLength(200);
		expect(items.hasMore('ready')).toBe(true);
		expect(events).toEqual([]);

		await items.loadMore('ready', 100);
		expect(items.byStatus('ready')).toHaveLength(250);
		expect(items.hasMore('ready')).toBe(false);
	});

	it('a poll that lands during a show-more flashes what the server added, not the grown rows', async () => {
		serve({ ready: 250 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();
		const events: string[][] = [];
		items.onItemsChanged((ids) => events.push(ids));

		// Someone else creates an item at the top of Ready while the window grows.
		vi.mocked(fetchClient.getResponse).mockImplementation(async (url: string) => {
			const params = new URL(url, 'http://x').searchParams;
			const status = params.get('status') as ItemStatus;
			const limit = Number(params.get('limit'));
			const total = status === 'ready' ? 251 : 0;
			const data = status === 'ready'
				? [row('ready', 900, 0), ...Array.from({ length: Math.min(limit - 1, 250) }, (_, i) => row('ready', i + 1))]
				: [];
			return { data, headers: new Headers({ 'X-Total-Count': String(total) }) };
		});
		const growing = items.loadMore('ready', 100);
		const poll = items.fetch();
		await Promise.all([growing, poll]);

		expect(items.loadedFor('ready')).toBe(200);
		expect(events).toEqual([['SB-ready-900']]);
	});

	it('reads a total of 0 as 0 and a missing header as "everything loaded"', async () => {
		vi.mocked(fetchClient.getResponse).mockImplementation(async (url: string) => {
			const status = new URL(url, 'http://x').searchParams.get('status') as ItemStatus;
			if (status === 'ready') return { data: [], headers: new Headers({ 'X-Total-Count': '0' }) };
			if (status === 'done') {
				// 101 rows back for limit 100 and no header: the boundary row must not count.
				return { data: Array.from({ length: 101 }, (_, i) => row('done', i + 1)), headers: new Headers() };
			}
			return { data: [], headers: new Headers({ 'X-Total-Count': '0' }) };
		});
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();

		expect(items.totalFor('ready')).toBe(0);
		expect(items.hasMore('ready')).toBe(false);
		expect(items.totalFor('done')).toBe(100);
		expect(items.hasMore('done')).toBe(false);
	});

	it('a poll re-requests the widened window, so it never shrinks', async () => {
		serve({ ready: 250 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();
		await items.loadMore('ready', 100);

		await items.fetch();

		expect(requestedLimit('ready')).toBe(201);
		expect(items.byStatus('ready')).toHaveLength(200);
	});

	it('ensureLimit widens every window, refetching only when some status has more', async () => {
		serve({ ready: 250, done: 3 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();
		vi.mocked(fetchClient.getResponse).mockClear();

		await items.ensureLimit(200);
		expect(requestedLimit('ready')).toBe(201);
		expect(requestedLimit('done')).toBe(201);
		expect(items.byStatus('ready')).toHaveLength(200);

		vi.mocked(fetchClient.getResponse).mockClear();
		await items.ensureLimit(150); // narrower than what is loaded: nothing to do
		expect(fetchClient.getResponse).not.toHaveBeenCalled();
	});

	it('ensureLimit is a no-op refetch when nothing has more', async () => {
		serve({ ready: 5, done: 3 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();
		vi.mocked(fetchClient.getResponse).mockClear();

		await items.ensureLimit(200);

		expect(fetchClient.getResponse).not.toHaveBeenCalled();
	});

	it('keeps an item this client moved past the window instead of dropping it on the next poll', async () => {
		serve({ ready: 1, done: 250 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();

		// Complete the one Ready item: it lands after the loaded Done cards, ranked past
		// the server's window (Done's rows 101+ carry rank 101+). The server now has
		// nothing in Ready and 251 in Done, none of whose first 100 is this item.
		const moved = items.byStatus('ready')[0]!;
		moved.status = 'done';
		moved.rank = 300;
		serve({ ready: 0, done: 251 });

		await items.fetch();

		expect(items.find((i) => i.key === moved.key)).toBe(moved);
		expect(moved.status).toBe('done');
		expect(items.byStatus('ready')).toHaveLength(0);
		expect(items.byStatus('done')).toHaveLength(101);
		expect(items.totalFor('done')).toBe(251);
		expect(items.hasMore('done')).toBe(true);
	});

	it('lets a page from another status override an item held past a window', async () => {
		serve({ ready: 250, in_progress: 1 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();

		// Created here on a full Ready column: server-appended, past the window.
		vi.mocked(fetchClient.post).mockResolvedValue({ ...row('ready', 900, 900), updatedAt: 't1' });
		const created = await items.add({ title: 'new', status: 'ready' });

		// Another client starts it: it now comes back in the In Progress page.
		vi.mocked(fetchClient.getResponse).mockImplementation(async (url: string) => {
			const params = new URL(url, 'http://x').searchParams;
			const status = params.get('status') as ItemStatus;
			const limit = Number(params.get('limit'));
			if (status === 'in_progress') {
				const data = [row('in_progress', 1), { ...row('ready', 900, 900), status: 'in_progress', updatedAt: 't2' }];
				return { data, headers: new Headers({ 'X-Total-Count': '2' }) };
			}
			const total = status === 'ready' ? 250 : 0;
			const data = Array.from({ length: Math.min(limit, total) }, (_, i) => row(status, i + 1));
			return { data, headers: new Headers({ 'X-Total-Count': String(total) }) };
		});
		await items.fetch();

		expect(items.find((i) => i.key === created.key)).toBe(created);
		expect(created.status).toBe('in_progress');
		expect(items.byStatus('in_progress')).toHaveLength(2);
		expect(items.byStatus('ready')).toHaveLength(100);
	});

	it('drops an item ranked inside the window that the page no longer returns', async () => {
		serve({ ready: 250 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();

		// Rank 50 sits inside the window (the boundary row carries rank 101), so its
		// absence from the page means the server dropped it, not that it is unloaded.
		vi.mocked(fetchClient.getResponse).mockImplementation(async (url: string) => {
			const params = new URL(url, 'http://x').searchParams;
			const status = params.get('status') as ItemStatus;
			const limit = Number(params.get('limit'));
			if (status !== 'ready') return { data: [], headers: new Headers({ 'X-Total-Count': '0' }) };
			const data = Array.from({ length: limit + 1 }, (_, i) => row('ready', i + 1)).filter((r) => r.rank !== 50);
			return { data, headers: new Headers({ 'X-Total-Count': '249' }) };
		});
		await items.fetch();

		expect(items.find((i) => i.key === 'SB-ready-50')).toBeUndefined();
		expect(items.firstUnloadedRank('ready')).toBe(102);
	});

	it('keeps an item that ties the boundary rank, and leaves its fields untouched', async () => {
		serve({ ready: 1, done: 250 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();

		const moved = items.byStatus('ready')[0]!;
		moved.status = 'done';
		moved.title = 'edited locally';
		moved.rank = items.firstUnloadedRank('done')!; // 101, same as the boundary row
		await items.fetch();

		expect(items.find((i) => i.key === moved.key)).toBe(moved);
		expect(moved.status).toBe('done');
		expect(moved.title).toBe('edited locally');
	});

	it('drops an item the server no longer returns inside the window', async () => {
		serve({ ready: 3 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();

		serve({ ready: 2 }); // SB-ready-3 deleted elsewhere
		await items.fetch();

		expect(items.byStatus('ready').map((i) => i.key)).toEqual(['SB-ready-1', 'SB-ready-2']);
		expect(items.totalFor('ready')).toBe(2);
	});

	it('counts local adds and removes in the total without touching the remainder', async () => {
		serve({ ready: 250 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();

		vi.mocked(fetchClient.post).mockResolvedValue({ ...row('ready', 999, 999), updatedAt: 't1' });
		await items.add({ title: 'new', status: 'ready' });

		expect(items.byStatus('ready')).toHaveLength(101);
		expect(items.totalFor('ready')).toBe(251);
		expect(items.hasMore('ready')).toBe(true);
	});

	it('refuses to load without a window limit', async () => {
		serve({});
		const items = new ItemsCollection({ projectSlug: 'demo' });
		await items.fetch();

		expect(items.$meta.error?.message).toMatch(/limit/);
	});
});
