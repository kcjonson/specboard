import { describe, expect, it, vi } from 'vitest';
import { MapSearchModel, createSearchSource } from './map-search';

const get = vi.fn();
vi.mock('@specboard/fetch', () => ({ fetchClient: { get: (...args: unknown[]) => get(...args) } }));

const deferred = <T,>(): { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void } => {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

describe('the search source', () => {
	it('asks the items list, which matches title, description, and key at every depth, and returns the keys', async () => {
		get.mockResolvedValue([{ key: 'SPE-3', title: 'x' }, { key: 'SPE-9' }]);
		const keys = await createSearchSource('acme/specboard')('check list');
		expect(get).toHaveBeenCalledWith('/api/projects/acme/specboard/items?search=check+list&limit=5000');
		expect(keys).toEqual(['SPE-3', 'SPE-9']);
	});
});

describe('the search model', () => {
	it('is idle with no query, searches a trimmed one, and ends the search when it is emptied', async () => {
		const source = vi.fn().mockResolvedValue(['A-1', 'A-2']);
		const model = new MapSearchModel(source);
		const changed = vi.fn();
		model.on('change', changed);
		expect(model).toMatchObject({ state: 'idle', keys: null, query: '' });

		model.setQuery('  checklist ');
		expect(model).toMatchObject({ state: 'loading', query: 'checklist' });
		await vi.waitFor(() => expect(model.state).toBe('ready'));
		expect(source).toHaveBeenCalledWith('checklist');
		expect(model.keys).toEqual(new Set(['A-1', 'A-2']));

		model.setQuery('');
		expect(model).toMatchObject({ state: 'idle', keys: null, query: '' });
		expect(changed).toHaveBeenCalled();
	});

	it('does not search again for the same text', async () => {
		const source = vi.fn().mockResolvedValue(['A-1']);
		const model = new MapSearchModel(source);
		model.setQuery('a');
		await vi.waitFor(() => expect(model.state).toBe('ready'));
		model.setQuery(' a ');
		expect(source).toHaveBeenCalledTimes(1);
	});

	it('keeps the last answer dimming while the next one loads, and drops an answer that comes back late', async () => {
		const first = deferred<string[]>();
		const second = deferred<string[]>();
		const source = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		const model = new MapSearchModel(source);
		model.setQuery('one');
		model.setQuery('two');
		// The first answer lands after the second was asked for: it is for a query nobody is waiting on.
		first.resolve(['OLD-1']);
		await first.promise;
		expect(model.keys).toBeNull();
		expect(model.state).toBe('loading');

		second.resolve(['NEW-1']);
		await vi.waitFor(() => expect(model.state).toBe('ready'));
		expect(model.keys).toEqual(new Set(['NEW-1']));

		const third = deferred<string[]>();
		source.mockReturnValueOnce(third.promise);
		model.setQuery('three');
		expect(model).toMatchObject({ state: 'loading', keys: new Set(['NEW-1']) });
	});

	it('ignores an answer that lands after the search was ended', async () => {
		const pending = deferred<string[]>();
		const model = new MapSearchModel(() => pending.promise);
		model.setQuery('late');
		model.setQuery('');
		pending.resolve(['LATE-1']);
		await pending.promise;
		expect(model).toMatchObject({ state: 'idle', keys: null });
	});

	it('says a search failed, lights nothing, and tries again on request or on the same text', async () => {
		const source = vi.fn().mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValue(['A-1']);
		const model = new MapSearchModel(source);
		model.setQuery('boom');
		await vi.waitFor(() => expect(model.state).toBe('error'));
		expect(model.error?.message).toBe('HTTP 500');
		expect(model.keys).toBeNull();

		model.retry();
		await vi.waitFor(() => expect(model.state).toBe('ready'));
		expect(model.keys).toEqual(new Set(['A-1']));
		expect(model.error).toBeNull();
	});

	it('stops telling anyone anything once disposed', async () => {
		const pending = deferred<string[]>();
		const model = new MapSearchModel(() => pending.promise);
		const changed = vi.fn();
		model.on('change', changed);
		model.setQuery('x');
		changed.mockClear();
		model.dispose();
		pending.resolve(['A-1']);
		await pending.promise;
		expect(changed).not.toHaveBeenCalled();
	});
});
