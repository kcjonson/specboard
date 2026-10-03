import { describe, expect, it, vi } from 'vitest';
import { BoardBuilder } from './layout/board-fixture';
import type { MapLayoutWorker } from './layout/layout-worker-client';
import { layoutMap } from './layout/layout';
import { MapDataModel, type MapRead } from './map-data-model';

function board(count: number): MapRead {
	const b = new BoardBuilder();
	for (let i = 0; i < count; i++) b.add({ status: i % 2 ? 'done' : 'ready' });
	return { items: b.rows, summarized: false };
}

/** A worker that answers with the real layout, when told to. */
function fakeWorker(): MapLayoutWorker & { pending: Array<() => void>; terminated: boolean; calls: number } {
	const worker = {
		pending: [] as Array<() => void>,
		terminated: false,
		calls: 0,
		layout: (input: Parameters<MapLayoutWorker['layout']>[0]) => {
			worker.calls++;
			return new Promise<{ layout: ReturnType<typeof layoutMap>; ms: number }>((resolve) => {
				worker.pending.push(() => resolve({ layout: layoutMap(input), ms: 1 }));
			});
		},
		terminate: () => {
			worker.terminated = true;
		},
	};
	return worker;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('MapDataModel', () => {
	it('is loading until the layout has settled, then ready with every dot at once', async () => {
		const worker = fakeWorker();
		const read = board(6);
		const model = new MapDataModel(() => Promise.resolve(read), () => worker);
		const changes = vi.fn();
		model.on('change', changes);

		const loading = model.load(2);
		expect(model.state).toBe('loading');
		await flush();
		// The read is in, but nothing is shown until the worker answers.
		expect(model.state).toBe('loading');
		expect(model.layout).toBeNull();

		worker.pending.shift()!();
		await loading;
		expect(model.state).toBe('ready');
		expect(model.layout!.nodes).toHaveLength(6);
		expect(model.rows.size).toBe(6);
		expect(model.isEmpty).toBe(false);
		expect(changes).toHaveBeenCalledTimes(2);
	});

	it('lays out for the plot shape it was asked for', async () => {
		const worker = fakeWorker();
		const spy = vi.spyOn(worker, 'layout');
		const model = new MapDataModel(() => Promise.resolve(board(3)), () => worker);
		const loading = model.load(3.5);
		await flush();
		expect(spy.mock.calls[0]![0]).toMatchObject({ aspect: 3.5, collapse: {} });
		worker.pending.shift()!();
		await loading;
	});

	it('is ready and empty for a project with no items, without waking the worker', async () => {
		const worker = fakeWorker();
		const create = vi.fn(() => worker);
		const model = new MapDataModel(() => Promise.resolve({ items: [], summarized: false }), create);
		await model.load(2);
		expect(model.state).toBe('ready');
		expect(model.isEmpty).toBe(true);
		expect(model.layout).toBeNull();
		expect(create).not.toHaveBeenCalled();
	});

	it('reports a failed read, and retries with the same shape', async () => {
		const worker = fakeWorker();
		const source = vi.fn().mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValue(board(2));
		const model = new MapDataModel(source, () => worker);
		await model.load(2.5);
		expect(model.state).toBe('error');
		expect(model.error!.message).toBe('HTTP 500');

		const retrying = model.retry();
		expect(model.state).toBe('loading');
		expect(model.error).toBeNull();
		await flush();
		worker.pending.shift()!();
		await retrying;
		expect(model.state).toBe('ready');
	});

	it('reports a failed layout as an error too', async () => {
		const worker = fakeWorker();
		worker.layout = () => Promise.reject(new Error('Map layout worker failed'));
		const model = new MapDataModel(() => Promise.resolve(board(2)), () => worker);
		await model.load(2);
		expect(model.state).toBe('error');
		expect(model.error!.message).toBe('Map layout worker failed');
	});

	it('drops an answer that a newer load has overtaken', async () => {
		const worker = fakeWorker();
		const reads = [board(2), board(5)];
		const model = new MapDataModel(() => Promise.resolve(reads.shift()!), () => worker);
		const first = model.load(2);
		await flush();
		const second = model.load(2);
		await flush();
		// Answer the older request last.
		worker.pending.pop()!();
		await second;
		worker.pending.pop()!();
		await first;
		expect(model.rows.size).toBe(5);
	});

	it('stops the worker and the listeners on dispose, and ignores what is still in flight', async () => {
		const worker = fakeWorker();
		const model = new MapDataModel(() => Promise.resolve(board(2)), () => worker);
		const changes = vi.fn();
		model.on('change', changes);
		const loading = model.load(2);
		await flush();
		changes.mockClear();
		model.dispose();
		expect(worker.terminated).toBe(true);
		worker.pending.shift()!();
		await loading;
		expect(model.state).toBe('loading');
		expect(changes).not.toHaveBeenCalled();
	});
});
