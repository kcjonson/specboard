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

/** The last URL requested for a status window. */
function requestedFor(status: ItemStatus): string | undefined {
	const calls = vi.mocked(fetchClient.getResponse).mock.calls.map(([url]) => url as string);
	return calls.filter((url) => url.includes(`status=${status}&`)).at(-1);
}

function requestedLimit(status: ItemStatus): number | undefined {
	const last = requestedFor(status);
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

	it('records a load at the width it requested, not one a show-more widened mid-flight', async () => {
		serve({ ready: 250 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();
		const events: string[][] = [];
		items.onItemsChanged((ids) => events.push(ids));

		// The poll's requests are out at 100 rows when the user hits "show more". If it
		// records the widened 200 as what it was served, the next load reads rows 101-200
		// as rows it already had — and flashes them as changes the server made.
		let release: () => void = () => {};
		const held = new Promise<void>((resolve) => { release = resolve; });
		vi.mocked(fetchClient.getResponse).mockImplementation(async (url: string) => {
			const params = new URL(url, 'http://x').searchParams;
			const status = params.get('status') as ItemStatus;
			const limit = Number(params.get('limit'));
			if (limit === 101) await held;
			const total = status === 'ready' ? 250 : 0;
			const data = Array.from({ length: Math.min(limit, total) }, (_, i) => row(status, i + 1));
			return { data, headers: new Headers({ 'X-Total-Count': String(total) }) };
		});

		const poll = items.fetch();
		const growing = items.loadMore('ready', 100);
		release();
		await Promise.all([poll, growing]);

		expect(requestedLimit('ready')).toBe(201);
		expect(items.byStatus('ready')).toHaveLength(200);
		expect(events).toEqual([]);
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

describe('ItemsCollection filters', () => {
	it('leaves the query string alone until a filter holds something', async () => {
		serve({ ready: 5 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();

		expect(fetchClient.getResponse).toHaveBeenCalledWith('/api/projects/demo/items?status=ready&limit=101');

		// Blank search and no type are the absence of a filter, not an empty one.
		vi.mocked(fetchClient.getResponse).mockClear();
		await items.setFilter({ search: '   ' });
		expect(fetchClient.getResponse).not.toHaveBeenCalled();
		expect(items.filterActive).toBe(false);

		await items.setFilter({ search: 'auth' });
		expect(items.filterActive).toBe(true);

		await items.setFilter({ search: '', type: 'bug' });
		expect(items.filterActive).toBe(true);

		await items.setFilter({});
		expect(items.filterActive).toBe(false);
	});

	it('puts the search and the type on every window request, url-encoded', async () => {
		serve({ ready: 5 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();

		await items.setFilter({ search: '  oauth login  ' });
		expect(requestedFor('ready')).toBe('/api/projects/demo/items?status=ready&limit=101&search=oauth+login');
		expect(requestedFor('done')).toBe('/api/projects/demo/items?status=done&limit=101&search=oauth+login');

		await items.setFilter({ search: 'oauth login', type: 'bug' });
		expect(requestedFor('ready')).toBe('/api/projects/demo/items?status=ready&limit=101&search=oauth+login&type=bug');

		await items.setFilter({ type: 'bug' });
		expect(requestedFor('ready')).toBe('/api/projects/demo/items?status=ready&limit=101&type=bug');
	});

	it('carries the filter through loadMore and ensureLimit', async () => {
		serve({ ready: 250 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();
		await items.setFilter({ search: 'auth' });

		await items.loadMore('ready', 100);
		expect(requestedFor('ready')).toBe('/api/projects/demo/items?status=ready&limit=201&search=auth');
		expect(items.byStatus('ready')).toHaveLength(200);

		await items.ensureLimit(300);
		expect(requestedFor('ready')).toBe('/api/projects/demo/items?status=ready&limit=301&search=auth');
	});

	it('a filter change starts the windows over at the base limit', async () => {
		serve({ ready: 250 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();
		await items.loadMore('ready', 100);
		expect(requestedLimit('ready')).toBe(201);

		await items.setFilter({ search: 'auth' });

		expect(requestedLimit('ready')).toBe(101);
		expect(items.byStatus('ready')).toHaveLength(100);
	});

	it('starts a new query at the width the table asked ensureLimit for', async () => {
		serve({ ready: 500 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();
		await items.ensureLimit(200); // the table view taking over from the board
		await items.loadMore('ready', 200); // and the user widening one section past that

		await items.setFilter({ search: 'auth' });

		// The per-query growth is gone; the floor the view needs is not.
		expect(requestedLimit('ready')).toBe(201);
		expect(requestedLimit('done')).toBe(201);
	});

	it('drops the items the old query was holding past its windows', async () => {
		serve({ ready: 1, done: 250 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();

		// Completed here: ranked past Done's window, so the collection holds it as an
		// identity row the poll must not drop (see the windows suite).
		const moved = items.byStatus('ready')[0]!;
		moved.status = 'done';
		moved.rank = 300;
		serve({ ready: 0, done: 251 });
		await items.fetch();
		expect(items.find((i) => i.key === moved.key)).toBe(moved);

		// The search still leaves Done with rows past its window, so the boundary that
		// held this item is back — but the query that put it there is gone, and a row
		// the new one never matched must not ride along on the old one's boundary.
		await items.setFilter({ search: 'auth' });

		expect(items.find((i) => i.key === moved.key)).toBeUndefined();
		expect(items.hasMore('done')).toBe(true);
		expect(items.totalFor('done')).toBe(251);
	});

	it('reports the filtered total the server sends, not the unfiltered one', async () => {
		serve({ ready: 250 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();
		expect(items.totalFor('ready')).toBe(250);

		serve({ ready: 12 }); // what the search matches
		await items.setFilter({ search: 'auth' });

		expect(items.totalFor('ready')).toBe(12);
		expect(items.hasMore('ready')).toBe(false);
		expect(items.byStatus('ready')).toHaveLength(12);
	});

	it('keeps child rows a search matched, parent key and all', async () => {
		serve({ ready: 0 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();

		vi.mocked(fetchClient.getResponse).mockImplementation(async (url: string) => {
			const status = new URL(url, 'http://x').searchParams.get('status') as ItemStatus;
			if (status !== 'ready') return { data: [], headers: new Headers({ 'X-Total-Count': '0' }) };
			const data = [
				row('ready', 1),
				{ ...row('ready', 2), parentKey: 'SB-9', childStats: { total: 0, done: 0, blocked: 0 } },
			];
			return { data, headers: new Headers({ 'X-Total-Count': '2' }) };
		});
		await items.setFilter({ search: 'auth' });

		const [top, child] = items.byStatus('ready');
		expect(top!.parentKey).toBeUndefined();
		expect(child!.parentKey).toBe('SB-9');
		expect(child!.childStats.total).toBe(0);
	});

	it('ignores a poll in flight when the filter changes, rows and window counts alike', async () => {
		serve({ ready: 3 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();
		const before = items.byStatus('ready').map((i) => i.key);
		const events: string[][] = [];
		items.onItemsChanged((ids) => events.push(ids));

		// The unfiltered poll went out before the search did; both are held so the
		// collection can be inspected between the two landing.
		let releasePoll: () => void = () => {};
		let releaseSearch: () => void = () => {};
		const heldPoll = new Promise<void>((resolve) => { releasePoll = resolve; });
		const heldSearch = new Promise<void>((resolve) => { releaseSearch = resolve; });
		vi.mocked(fetchClient.getResponse).mockImplementation(async (url: string) => {
			const params = new URL(url, 'http://x').searchParams;
			const status = params.get('status') as ItemStatus;
			const search = params.get('search');
			await (search ? heldSearch : heldPoll);
			if (status !== 'ready') return { data: [], headers: new Headers({ 'X-Total-Count': '0' }) };
			// The poll answers the old question: different rows, and a total that would
			// leave the collection claiming there is more of a status it never asked about.
			const data = search ? [row('ready', 700, 700)] : [row('ready', 900, 900)];
			return { data, headers: new Headers({ 'X-Total-Count': search ? '1' : '400' }) };
		});

		const poll = items.fetch();
		const filtered = items.setFilter({ search: 'abc' });
		releasePoll();
		await poll;

		expect(items.byStatus('ready').map((i) => i.key)).toEqual(before);
		expect(items.totalFor('ready')).toBe(3);
		expect(items.hasMore('ready')).toBe(false);

		releaseSearch();
		await filtered;

		expect(items.byStatus('ready').map((i) => i.key)).toEqual(['SB-ready-700']);
		expect(items.totalFor('ready')).toBe(1);
		// Neither the discarded poll nor the rows the new query brought are changes.
		expect(events).toEqual([]);
	});

	it('ignores a page that lands after the query moved on', async () => {
		serve({ ready: 3 });
		const items = new ItemsCollection({ projectSlug: 'demo', limit: 100 });
		await items.fetch();
		const before = items.byStatus('ready').map((i) => i.key);

		// "ab" is still in flight when "abc" replaces it. Its rows answer a question
		// the user has left, so none of them may reach the collection.
		let releaseStale: () => void = () => {};
		const stale = new Promise<void>((resolve) => { releaseStale = resolve; });
		const seen: string[] = [];
		vi.mocked(fetchClient.getResponse).mockImplementation(async (url: string) => {
			const params = new URL(url, 'http://x').searchParams;
			const status = params.get('status') as ItemStatus;
			const search = params.get('search');
			if (search === 'ab') await stale;
			const n = search === 'ab' ? 900 : 700;
			const data = status === 'ready' ? [row('ready', n, n)] : [];
			return { data, headers: new Headers({ 'X-Total-Count': String(data.length) }) };
		});

		const staleQuery = items.setFilter({ search: 'ab' });
		const newer = items.setFilter({ search: 'abc' });
		// The superseded response lands first; the collection must sit still for it.
		releaseStale();
		await staleQuery;
		seen.push(...items.byStatus('ready').map((i) => i.key));
		await newer;

		expect(seen).toEqual(before);
		expect(items.byStatus('ready').map((i) => i.key)).toEqual(['SB-ready-700']);
	});
});
