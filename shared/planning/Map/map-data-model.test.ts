import { describe, expect, it, vi } from 'vitest';
import { BoardBuilder } from './layout/board-fixture';
import type { MapLayoutWorker } from './layout/layout-worker-client';
import { layoutMap } from './layout/layout';
import type { MapLayoutInput } from './layout/types';
import type { MapRead } from '@specboard/core/map-read';
import { memoryCollapseStore } from './collapse-store.fixture';
import { MapDataModel } from './map-data-model';

function board(count: number): MapRead {
	const b = new BoardBuilder();
	for (let i = 0; i < count; i++) b.add({ status: i % 2 ? 'done' : 'ready' });
	return { items: b.rows, summarized: false };
}

/** A worker that answers with the real layout, when told to. */
function fakeWorker(): MapLayoutWorker & { pending: Array<() => void>; terminated: boolean; calls: number; inputs: MapLayoutInput[] } {
	const worker = {
		pending: [] as Array<() => void>,
		terminated: false,
		calls: 0,
		inputs: [] as MapLayoutInput[],
		layout: (input: MapLayoutInput) => {
			worker.calls++;
			worker.inputs.push(input);
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
		const model = new MapDataModel(() => Promise.resolve(read), () => worker, memoryCollapseStore());
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
		const model = new MapDataModel(() => Promise.resolve(board(3)), () => worker, memoryCollapseStore());
		const loading = model.load(3.5);
		await flush();
		expect(spy.mock.calls[0]![0]).toMatchObject({ aspect: 3.5, collapse: {} });
		worker.pending.shift()!();
		await loading;
	});

	it('is ready and empty for a project with no items, without waking the worker', async () => {
		const worker = fakeWorker();
		const create = vi.fn(() => worker);
		const model = new MapDataModel(() => Promise.resolve({ items: [], summarized: false }), create, memoryCollapseStore());
		await model.load(2);
		expect(model.state).toBe('ready');
		expect(model.isEmpty).toBe(true);
		expect(model.layout).toBeNull();
		expect(create).not.toHaveBeenCalled();
	});

	it('reports a failed read, and retries with the same shape', async () => {
		const worker = fakeWorker();
		const source = vi.fn().mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValue(board(2));
		const model = new MapDataModel(source, () => worker, memoryCollapseStore());
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
		const model = new MapDataModel(() => Promise.resolve(board(2)), () => worker, memoryCollapseStore());
		await model.load(2);
		expect(model.state).toBe('error');
		expect(model.error!.message).toBe('Map layout worker failed');
	});

	it('starts a fresh worker on Retry after the layout failed, since a failed worker never answers again', async () => {
		const dead = fakeWorker();
		dead.layout = () => Promise.reject(new Error('Map layout worker failed'));
		const fresh = fakeWorker();
		const workers = [dead, fresh];
		const model = new MapDataModel(() => Promise.resolve(board(2)), () => workers.shift()!, memoryCollapseStore());
		await model.load(2);
		expect(model.state).toBe('error');
		expect(dead.terminated).toBe(true);

		const retrying = model.retry();
		await flush();
		fresh.pending.shift()!();
		await retrying;
		expect(model.state).toBe('ready');
	});

	it('drops an answer that a newer load has overtaken', async () => {
		const worker = fakeWorker();
		const reads = [board(2), board(5)];
		const model = new MapDataModel(() => Promise.resolve(reads.shift()!), () => worker, memoryCollapseStore());
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
		const model = new MapDataModel(() => Promise.resolve(board(2)), () => worker, memoryCollapseStore());
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

	it('lays out with the remembered choices, and a new choice reruns it in place, remembered', async () => {
		const b = new BoardBuilder();
		const open = b.add({ type: 'epic', status: 'in_progress' });
		b.add({ parentKey: open.key, status: 'ready' });
		const finished = b.add({ type: 'epic', status: 'done' });
		b.add({ parentKey: finished.key, status: 'done' });
		b.add({ parentKey: finished.key, status: 'done' });
		const worker = fakeWorker();
		const store = memoryCollapseStore({ [open.key]: true });
		const model = new MapDataModel(() => Promise.resolve({ items: b.rows, summarized: false }), () => worker, store);
		const loading = model.load(2);
		await flush();
		expect(worker.inputs[0]!.collapse).toEqual({ [open.key]: true });
		worker.pending.shift()!();
		await loading;
		expect(model.layout!.collapsed.sort()).toEqual([open.key, finished.key].sort());

		const changes = vi.fn();
		model.on('change', changes);
		const expanding = model.setCollapsed(finished.key, false);
		expect(model.state).toBe('ready');
		expect(store.choices).toEqual({ [open.key]: true, [finished.key]: false });
		const input = worker.inputs[1]!;
		expect(input.collapse).toEqual({ [open.key]: true, [finished.key]: false });
		expect(input.previous!.changed).toEqual([finished.key]);
		expect(input.previous!.frame).toBe(model.layout!.frame);
		expect(input.now).toBe(model.now);
		worker.pending.shift()!();
		await expanding;
		expect(model.layout!.regions.map((region) => region.key)).toEqual([finished.key]);
		expect(changes).toHaveBeenCalledTimes(1);
	});

	it('ignores a collapse before the Map is ready', async () => {
		const worker = fakeWorker();
		const store = memoryCollapseStore();
		const model = new MapDataModel(() => new Promise(() => {}), () => worker, store);
		void model.load(2);
		await model.setCollapsed('MAP-1', true);
		expect(store.choices).toEqual({});
		expect(worker.calls).toBe(0);
	});

	it('carries every toggle still in flight into the next pass, and keeps only the last answer', async () => {
		const b = new BoardBuilder();
		const one = b.add({ type: 'epic', status: 'in_progress' });
		b.add({ parentKey: one.key, status: 'ready' });
		const two = b.add({ type: 'epic', status: 'in_progress' });
		b.add({ parentKey: two.key, status: 'ready' });
		const worker = fakeWorker();
		const model = new MapDataModel(() => Promise.resolve({ items: b.rows, summarized: false }), () => worker, memoryCollapseStore());
		const loading = model.load(2);
		await flush();
		worker.pending.shift()!();
		await loading;

		const first = model.setCollapsed(one.key, true);
		const second = model.setCollapsed(two.key, true);
		expect(worker.inputs[1]!.previous!.changed).toEqual([one.key]);
		expect(worker.inputs[2]!.previous!.changed).toEqual([one.key, two.key]);
		expect(worker.inputs[2]!.collapse).toEqual({ [one.key]: true, [two.key]: true });
		worker.pending.shift()!();
		await first;
		expect(model.layout!.collapsed).toEqual([]);
		worker.pending.shift()!();
		await second;
		expect(model.layout!.collapsed.sort()).toEqual([one.key, two.key].sort());

		const third = model.setCollapsed(one.key, false);
		expect(worker.inputs[3]!.previous!.changed).toEqual([one.key]);
		worker.pending.shift()!();
		await third;
	});
});
