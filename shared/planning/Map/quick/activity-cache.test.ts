import { describe, expect, it, vi } from 'vitest';
import { fetchClient } from '@specboard/fetch';
import { ActivityCache, createActivitySource, type ActivityEntry } from './activity-cache';

const entry = (id: string, note: string): ActivityEntry => ({ id, note, actor: null, createdAt: '2026-10-01T10:00:00.000Z' });
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('the quick card activity source', () => {
	it('asks for the newest entry only, not the whole log', async () => {
		const get = vi.spyOn(fetchClient, 'get').mockResolvedValue([]);
		await createActivitySource('acme/specboard')('SB-1');
		expect(get).toHaveBeenCalledWith('/api/projects/acme/specboard/items/SB-1/notes?limit=1');
		get.mockRestore();
	});
});

describe('the quick card activity cache', () => {
	it('says loading until the log arrives, then holds its newest entry', async () => {
		const source = vi.fn().mockResolvedValue([entry('2', 'newest'), entry('1', 'older')]);
		const cache = new ActivityCache(source);
		expect(cache.get('A-1')).toEqual({ state: 'loading' });
		cache.request('A-1');
		expect(cache.get('A-1')).toEqual({ state: 'loading' });
		await flush();
		expect(cache.get('A-1')).toMatchObject({ state: 'ready', entry: { note: 'newest' } });
	});

	it('asks once per item for the life of the view, while it is in flight and after', async () => {
		const source = vi.fn().mockResolvedValue([entry('1', 'x')]);
		const cache = new ActivityCache(source);
		cache.request('A-1');
		cache.request('A-1');
		await flush();
		cache.request('A-1');
		cache.request('A-2');
		expect(source).toHaveBeenCalledTimes(2);
		expect(source).toHaveBeenNthCalledWith(1, 'A-1');
		expect(source).toHaveBeenNthCalledWith(2, 'A-2');
	});

	it('reports an item with no activity, and tells subscribers when anything settles', async () => {
		const cache = new ActivityCache(() => Promise.resolve([]));
		const listener = vi.fn();
		cache.subscribe(listener);
		cache.request('A-1');
		await flush();
		expect(cache.get('A-1')).toEqual({ state: 'ready', entry: null });
		expect(listener).toHaveBeenCalled();
	});

	it('remembers a failure only until the next ask, which retries', async () => {
		const source = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([entry('1', 'back')]);
		const cache = new ActivityCache(source);
		cache.request('A-1');
		await flush();
		expect(cache.get('A-1')).toEqual({ state: 'error' });
		cache.request('A-1');
		await flush();
		expect(cache.get('A-1')).toMatchObject({ state: 'ready', entry: { note: 'back' } });
		expect(source).toHaveBeenCalledTimes(2);
	});
});
