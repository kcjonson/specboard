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
		// the server's window (Done's rows 101+ carry rank 101+).
		const moved = items.byStatus('ready')[0]!;
		moved.status = 'done';
		moved.rank = 300;

		await items.fetch();

		expect(items.find((i) => i.key === moved.key)).toBe(moved);
		expect(items.byStatus('done')).toHaveLength(101);
		expect(items.totalFor('done')).toBe(250);
		expect(items.hasMore('done')).toBe(true);
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
