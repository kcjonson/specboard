import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapChange } from '@specboard/core/map-changes';
import { MapChangesModel, createChangesSource, type ChangesSource } from './changes-model';

const fetchClient = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@specboard/fetch', () => ({ fetchClient }));

afterEach(() => {
	fetchClient.get.mockReset();
	fetchClient.post.mockReset();
});

const CHANGES: MapChange[] = [{ key: 'SPE-1', kind: 'finished', at: 1_790_000_100_000 }];

function source(read: Awaited<ReturnType<ChangesSource['read']>> | Error): { source: ChangesSource; advance: ReturnType<typeof vi.fn> } {
	const advance = vi.fn().mockResolvedValue(undefined);
	return { source: { read: () => (read instanceof Error ? Promise.reject(read) : Promise.resolve(read)), advance }, advance };
}

describe('MapChangesModel', () => {
	it('holds the baseline, the read time, and the changes once the read lands', async () => {
		const { source: s } = source({ baseline: 1_790_000_000_000, readAt: 1_790_200_000_000, changes: CHANGES });
		const model = new MapChangesModel(s);
		expect(model.state).toBe('loading');

		await model.load();

		expect(model).toMatchObject({ state: 'ready', baseline: 1_790_000_000_000, readAt: 1_790_200_000_000, changes: CHANGES });
	});

	it('sets the baseline at once on a first visit, from the read time, and shows nothing', async () => {
		const { source: s, advance } = source({ baseline: null, readAt: 1_790_200_000_000, changes: [] });
		const model = new MapChangesModel(s);

		await model.load();

		expect(model.changes).toEqual([]);
		expect(advance).toHaveBeenCalledTimes(1);
		expect(advance).toHaveBeenCalledWith(1_790_200_000_000, { keepalive: false });
	});

	it('does not touch the baseline just by loading it', async () => {
		const { source: s, advance } = source({ baseline: 1_790_000_000_000, readAt: 1_790_200_000_000, changes: CHANGES });

		await new MapChangesModel(s).load();

		expect(advance).not.toHaveBeenCalled();
	});

	it('marks everything seen: the changes are gone, and the baseline is asked to move to the read time, not the clock', async () => {
		vi.useFakeTimers({ now: 1_999_999_999_000 });
		const { source: s, advance } = source({ baseline: 1_790_000_000_000, readAt: 1_790_200_000_000, changes: CHANGES });
		const model = new MapChangesModel(s);
		await model.load();
		const changed = vi.fn();
		model.on('change', changed);

		model.markSeen();

		expect(model.changes).toEqual([]);
		expect(model.baseline).toBe(1_790_200_000_000);
		expect(changed).toHaveBeenCalled();
		expect(advance).toHaveBeenCalledWith(1_790_200_000_000, { keepalive: false });
		vi.useRealTimers();
	});

	it('moves the baseline when the person leaves, with keepalive, and only once however often it is told', async () => {
		const { source: s, advance } = source({ baseline: 1_790_000_000_000, readAt: 1_790_200_000_000, changes: CHANGES });
		const model = new MapChangesModel(s);
		await model.load();

		model.leave();
		model.leave();

		expect(advance).toHaveBeenCalledTimes(1);
		expect(advance).toHaveBeenCalledWith(1_790_200_000_000, { keepalive: true });
	});

	it('does not ask again on leaving after Mark all seen already did', async () => {
		const { source: s, advance } = source({ baseline: 1_790_000_000_000, readAt: 1_790_200_000_000, changes: CHANGES });
		const model = new MapChangesModel(s);
		await model.load();

		model.markSeen();
		model.leave();

		expect(advance).toHaveBeenCalledTimes(1);
	});

	it('asks again on leaving when Mark all seen failed to reach the server', async () => {
		const { source: s, advance } = source({ baseline: 1_790_000_000_000, readAt: 1_790_200_000_000, changes: CHANGES });
		advance.mockRejectedValueOnce(new Error('HTTP 500'));
		const model = new MapChangesModel(s);
		await model.load();

		model.markSeen();
		await Promise.resolve();
		await Promise.resolve();
		model.leave();

		expect(advance).toHaveBeenCalledTimes(2);
		expect(advance).toHaveBeenLastCalledWith(1_790_200_000_000, { keepalive: true });
	});

	it('sends nothing when the person leaves before the read lands, or when it failed', async () => {
		const early = source({ baseline: 1_790_000_000_000, readAt: 1_790_200_000_000, changes: CHANGES });
		const loading = new MapChangesModel(early.source);
		void loading.load();
		loading.leave();
		await Promise.resolve();
		expect(early.advance).not.toHaveBeenCalled();

		const failing = source(new Error('HTTP 500'));
		const failed = new MapChangesModel(failing.source);
		await failed.load();
		failed.leave();
		expect(failed.state).toBe('error');
		expect(failing.advance).not.toHaveBeenCalled();
	});

	it('drops a read that lands after the person has left', async () => {
		let land: (read: Awaited<ReturnType<ChangesSource['read']>>) => void = () => {};
		const advance = vi.fn().mockResolvedValue(undefined);
		const model = new MapChangesModel({ read: () => new Promise((resolve) => (land = resolve)), advance });
		const loading = model.load();

		model.leave();
		land({ baseline: null, readAt: 1_790_200_000_000, changes: [] });
		await loading;

		expect(model.state).toBe('loading');
		expect(advance).not.toHaveBeenCalled();
	});
});

describe('createChangesSource', () => {
	it('reads the changes for the project and decodes them', async () => {
		fetchClient.get.mockResolvedValue({ projectKey: 'SPE', baseline: 1_790_000_000_000, readAt: 1_790_200_000_000, number: [7], kind: ['filed'], at: [1_790_100_000_000] });

		const read = await createChangesSource('acme/specboard').read();

		expect(fetchClient.get).toHaveBeenCalledWith('/api/projects/acme/specboard/map/changes');
		expect(read).toEqual({ baseline: 1_790_000_000_000, readAt: 1_790_200_000_000, changes: [{ key: 'SPE-7', kind: 'filed', at: 1_790_100_000_000 }] });
	});

	it('posts the read time to move the baseline, with keepalive when asked', async () => {
		fetchClient.post.mockResolvedValue({ baseline: 1_790_200_000_000 });

		await createChangesSource('acme/specboard').advance(1_790_200_000_000, { keepalive: true });

		expect(fetchClient.post).toHaveBeenCalledWith('/api/projects/acme/specboard/map/seen', { readAt: 1_790_200_000_000 }, { keepalive: true });
	});
});
