import { describe, expect, it, vi } from 'vitest';
import { BoardBuilder, deltaRead, iso, wholeRead } from './layout/board-fixture';
import type { MapLayoutWorker } from './layout/layout-worker-client';
import { layoutMap } from './layout/layout';
import type { MapLayoutInput } from './layout/types';
import type { MapItemRow, MapRead } from '@specboard/core/map-read';
import { memoryCollapseStore } from './collapse-store.fixture';
import { MapDataModel } from './map-data-model';
import { NO_CHANGES } from './map-changes';
import { buildModel } from './layout/model';

function board(count: number): MapRead {
	const b = new BoardBuilder();
	for (let i = 0; i < count; i++) b.add({ status: i % 2 ? 'done' : 'ready' });
	return wholeRead(b.rows);
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
		const model = new MapDataModel(() => Promise.resolve(wholeRead([])), create, memoryCollapseStore());
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
		const model = new MapDataModel(() => Promise.resolve(wholeRead(b.rows)), () => worker, store);
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
		const model = new MapDataModel(() => Promise.resolve(wholeRead(b.rows)), () => worker, memoryCollapseStore());
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

describe('MapDataModel refresh', () => {
	const HOUR = 3_600_000;

	/** A loaded model over a few ready items and an epic, with a source the test answers and a clock it moves. */
	async function loaded(): Promise<{
		model: MapDataModel;
		worker: ReturnType<typeof fakeWorker>;
		b: BoardBuilder;
		reads: Array<MapRead | Error>;
		asked: Array<number | null>;
		clock: { now: number };
		epic: string;
		child: string;
	}> {
		const b = new BoardBuilder();
		for (let i = 0; i < 4; i++) b.add({ status: 'ready', created: b.now - (10 - i) * 24 * HOUR });
		const epic = b.add({ type: 'epic', status: 'done', completed: b.now - 5 * 24 * HOUR }).key;
		const child = b.add({ parentKey: epic, status: 'done', completed: b.now - 5 * 24 * HOUR }).key;
		// Worked on an hour ago, so the board is live and its edge is now.
		b.add({ status: 'in_progress', started: b.now - HOUR });
		const worker = fakeWorker();
		const reads: Array<MapRead | Error> = [wholeRead([...b.rows])];
		const asked: Array<number | null> = [];
		const clock = { now: b.now };
		const source = (since: number | null): Promise<MapRead> => {
			asked.push(since);
			const next = reads.shift()!;
			return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
		};
		const model = new MapDataModel(source, () => worker, memoryCollapseStore(), () => clock.now);
		const loading = model.load(2);
		await flush();
		worker.pending.shift()!();
		await loading;
		return { model, worker, b, reads, asked, clock, epic, child };
	}

	/** Lets promise callbacks run without a timer, which the tests that fake timers can't wait on. */
	const drain = async (): Promise<void> => {
		for (let i = 0; i < 20; i++) await Promise.resolve();
	};

	const settle = async (worker: ReturnType<typeof fakeWorker>): Promise<void> => {
		await drain();
		worker.pending.shift()!();
		await drain();
	};

	it('asks for what changed since the read it has, and applies it as a local pass', async () => {
		const { model, worker, b, reads, asked, clock } = await loaded();
		const picked = { ...b.rows[1]!, status: 'in_progress' as const, startedAt: iso(b.now + 5000), timeAnchor: iso(b.now + 5000) };
		reads.push(deltaRead([picked], b.rows.length, { cursor: b.now + 9000 }));
		clock.now = b.now + 10_000;

		expect(await model.refresh()).toBe(true);
		expect(asked).toEqual([null, wholeRead(b.rows).cursor]);
		const input = worker.inputs[1]!;
		expect(input.previous!.changed).toEqual([picked.key]);
		expect(input.now).toBe(clock.now);
		expect(input.outlineSteps).toEqual([5]);
		await settle(worker);

		expect(model.rows.get(picked.key)).toBe(picked);
		expect([...model.changes!.moved]).toEqual([picked.key]);
		expect([...model.changes!.restyled]).toEqual([picked.key]);
		expect(model.read!.cursor).toBe(b.now + 9000);
		expect(model.now).toBe(clock.now);
	});

	it('moves a parent with a delta that carries only its child, since the parent anchors on its subtree', async () => {
		const { model, worker, b, reads, clock, epic, child } = await loaded();
		const reopened = { ...model.rows.get(child)!, status: 'in_progress' as const, completedAt: null, timeAnchor: iso(b.now + 5000) };
		reads.push(deltaRead([reopened], b.rows.length));
		clock.now = b.now + 10_000;

		await model.refresh();
		const input = worker.inputs[1]!;
		expect(input.previous!.changed).toEqual([child]);
		expect(buildModel(input.rows, input.now, {}).byKey.get(epic)!.anchor).toBe(Date.parse(reopened.timeAnchor));
		await settle(worker);

		// No longer finished, the family opens around the reopened child.
		expect(model.layout!.regions.map((region) => region.key)).toEqual([epic]);
	});

	it('moves only the cursor on an idle poll: no pass, and no new rows', async () => {
		const { model, worker, b, reads, clock } = await loaded();
		const rows = model.rows;
		reads.push(deltaRead([], b.rows.length, { cursor: b.now + 9000 }));
		clock.now = b.now + 10_000;
		const changes = vi.fn();
		model.on('change', changes);

		await model.refresh();
		await flush();

		expect(worker.calls).toBe(1);
		expect(model.rows).toBe(rows);
		expect(model.read!.cursor).toBe(b.now + 9000);
		expect(model.loadedAt).toBe(clock.now);
	});

	it('reads the whole project again when the count says something was deleted', async () => {
		const { model, worker, b, reads, asked } = await loaded();
		const gone = b.rows[0]!.key;
		reads.push(deltaRead([], b.rows.length - 1), wholeRead(b.rows.slice(1)));

		await model.refresh();
		expect(asked.slice(1)).toEqual([wholeRead(b.rows).cursor, null]);
		await settle(worker);

		expect(model.rows.has(gone)).toBe(false);
		expect([...model.changes!.removed]).toEqual([gone]);
	});

	it('reads the whole project again when the spec links changed, which no updated_at shows', async () => {
		const { model, b, reads, asked } = await loaded();
		reads.push(deltaRead([], b.rows.length, { specs: '1:1790000000000' }), wholeRead(b.rows, { specs: '1:1790000000000' }));

		await model.refresh();

		expect(asked.slice(1)).toEqual([wholeRead(b.rows).cursor, null]);
	});

	it('buffers what arrives and applies it at most once a second', async () => {
		const { model, worker, b, reads, clock } = await loaded();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		try {
			const pick = (i: number, at: number): MapItemRow => ({ ...b.rows[i]!, status: 'in_progress', startedAt: iso(at), timeAnchor: iso(at) });
			reads.push(deltaRead([pick(0, b.now + 1)], b.rows.length));
			await model.refresh();
			expect(worker.calls).toBe(2);
			await settle(worker);

			clock.now += 200;
			reads.push(deltaRead([pick(1, b.now + 2)], b.rows.length));
			await model.refresh();
			clock.now += 300;
			reads.push(deltaRead([pick(2, b.now + 3)], b.rows.length));
			await model.refresh();
			expect(worker.calls).toBe(2);

			// The pass that applied the first change began at b.now; the next waits out the second after it.
			vi.advanceTimersByTime(799);
			expect(worker.calls).toBe(2);
			clock.now += 500;
			vi.advanceTimersByTime(1);
			expect(worker.calls).toBe(3);
			expect([...worker.inputs[2]!.previous!.changed].sort()).toEqual([b.rows[1]!.key, b.rows[2]!.key].sort());
			await settle(worker);
			expect([...model.changes!.moved].sort()).toEqual([b.rows[1]!.key, b.rows[2]!.key].sort());
		} finally {
			vi.useRealTimers();
		}
	});

	it('names an agent write, which the item row carries though its updated_at never moved', async () => {
		const { model, worker, b, reads, clock } = await loaded();
		const working = { ...b.rows[3]!, status: 'in_progress' as const };
		reads.push(deltaRead([working], b.rows.length));
		await model.refresh();
		await settle(worker);
		const wrote = { ...working, timeAnchor: iso(b.now + 20_000), workers: [{ sessionKey: 's1', deviceName: 'laptop', client: 'claude-code', branch: null, startedAt: iso(b.now), lastWriteAt: iso(b.now + 20_000) }] };
		reads.push(deltaRead([wrote], b.rows.length));
		clock.now += 2000;

		await model.refresh();
		await settle(worker);

		expect([...model.changes!.wrote]).toEqual([wrote.key]);
		expect(model.changes!.restyled.size).toBe(0);
	});

	it('holds the Map and says it is retrying when a refresh fails, and tells the poll to back off', async () => {
		const { model, b, reads } = await loaded();
		reads.push(new Error('HTTP 503'), deltaRead([], b.rows.length));
		const loadedAt = model.loadedAt;

		expect(await model.refresh()).toBe(false);
		expect(model.state).toBe('ready');
		expect(model.retrying).toBe(true);
		expect(model.loadedAt).toBe(loadedAt);

		expect(await model.refresh()).toBe(true);
		expect(model.retrying).toBe(false);
	});

	it('lays out again for time drift alone once it would show, and not on every idle poll', async () => {
		const { model, worker, b, reads, clock } = await loaded();
		reads.push(deltaRead([], b.rows.length), deltaRead([], b.rows.length));
		clock.now = b.now + 10_000;
		await model.refresh();
		await flush();
		expect(worker.calls).toBe(1);

		clock.now = b.now + 3 * HOUR;
		await model.refresh();
		expect(worker.calls).toBe(2);
		expect(worker.inputs[1]!.now).toBe(clock.now);
		await settle(worker);
		expect(model.layout!.frame.scale.edge).toBeGreaterThan(b.now);
	});

	it('does not wait out the buffer for a collapse, which is the person\'s own act, and cuts rather than glides', async () => {
		const { model, worker, b, reads, epic } = await loaded();
		reads.push(deltaRead([{ ...b.rows[0]!, timeAnchor: iso(b.now + 1) }], b.rows.length));
		await model.refresh();
		await settle(worker);

		const toggling = model.setCollapsed(epic, false);
		expect(worker.calls).toBe(3);
		expect(worker.inputs[2]!.now).toBe(model.now);
		await settle(worker);
		await toggling;
		expect(model.changes).toBe(NO_CHANGES);
	});
});
