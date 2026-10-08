import { describe, expect, it, vi } from 'vitest';
import { BoardBuilder, NOW, deltaRead, iso, wholeRead } from './layout/board-fixture';
import type { MapLayoutWorker } from './layout/layout-worker-client';
import { layoutMap } from './layout/layout';
import { traceRegions, type RegionInput } from './regions/outline';
import type { MapLayoutInput } from './layout/types';
import type { MapItemRow, MapRead } from '@specboard/core/map-read';
import { FetchError } from '@specboard/fetch';
import { memoryCollapseStore } from './collapse-store.fixture';
import { MapDataModel, type MapProjectSource, type MapReadSource } from './map-data-model';
import { buildModel } from './layout/model';

/** A project's own Map reads one project. */
const own = (read: MapReadSource): MapProjectSource[] => [{ ref: 'acme/map', read }];

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
		outlines: (inputs: readonly RegionInput[], step: number) => Promise.resolve(traceRegions(inputs, step)),
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
		const model = new MapDataModel(own(() => Promise.resolve(read)), () => worker, memoryCollapseStore());
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
		const model = new MapDataModel(own(() => Promise.resolve(board(3))), () => worker, memoryCollapseStore());
		const loading = model.load(3.5);
		await flush();
		expect(spy.mock.calls[0]![0]).toMatchObject({ aspect: 3.5, collapse: {} });
		worker.pending.shift()!();
		await loading;
	});

	it('is ready and empty for a project with no items, asking the worker for nothing', async () => {
		const worker = fakeWorker();
		const model = new MapDataModel(own(() => Promise.resolve(wholeRead([]))), () => worker, memoryCollapseStore());
		await model.load(2);
		expect(model.state).toBe('ready');
		expect(model.isEmpty).toBe(true);
		expect(model.layout).toBeNull();
		expect(worker.calls).toBe(0);
	});

	it('starts the worker while the read is still on the wire', async () => {
		const worker = fakeWorker();
		const create = vi.fn(() => worker);
		let land!: (read: MapRead) => void;
		const model = new MapDataModel(own(() => new Promise<MapRead>((resolve) => (land = resolve))), create, memoryCollapseStore());
		void model.load(2);
		expect(create).toHaveBeenCalledTimes(1);
		expect(worker.calls).toBe(0);
		land(board(2));
	});

	it('reports a failed read, and retries with the same shape', async () => {
		const worker = fakeWorker();
		const source = vi.fn().mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValue(board(2));
		const model = new MapDataModel(own(source), () => worker, memoryCollapseStore());
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
		const model = new MapDataModel(own(() => Promise.resolve(board(2))), () => worker, memoryCollapseStore());
		await model.load(2);
		expect(model.state).toBe('error');
		expect(model.error!.message).toBe('Map layout worker failed');
	});

	it('starts a fresh worker on Retry after the layout failed, since a failed worker never answers again', async () => {
		const dead = fakeWorker();
		dead.layout = () => Promise.reject(new Error('Map layout worker failed'));
		const fresh = fakeWorker();
		const workers = [dead, fresh];
		const model = new MapDataModel(own(() => Promise.resolve(board(2))), () => workers.shift()!, memoryCollapseStore());
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
		const model = new MapDataModel(own(() => Promise.resolve(reads.shift()!)), () => worker, memoryCollapseStore());
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
		const model = new MapDataModel(own(() => Promise.resolve(board(2))), () => worker, memoryCollapseStore());
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
		const model = new MapDataModel(own(() => Promise.resolve(wholeRead(b.rows))), () => worker, store);
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
		const model = new MapDataModel(own(() => new Promise(() => {})), () => worker, store);
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
		const model = new MapDataModel(own(() => Promise.resolve(wholeRead(b.rows))), () => worker, memoryCollapseStore());
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
		const model = new MapDataModel(own(source), () => worker, memoryCollapseStore(), () => clock.now);
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
		expect(model.now).toBe(clock.now);

		reads.push(deltaRead([], b.rows.length));
		await model.refresh();
		expect(asked.at(-1)).toBe(b.now + 9000);
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
		const { model, worker, b, reads, asked, clock } = await loaded();
		const rows = model.rows;
		reads.push(deltaRead([], b.rows.length, { cursor: b.now + 9000 }));
		clock.now = b.now + 10_000;
		const changes = vi.fn();
		model.on('change', changes);

		await model.refresh();
		await flush();

		expect(worker.calls).toBe(1);
		expect(model.rows).toBe(rows);
		expect(model.loadedAt).toBe(clock.now);

		reads.push(deltaRead([], b.rows.length));
		await model.refresh();
		expect(asked.at(-1)).toBe(b.now + 9000);
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
		expect(model.changes).toBeNull();
	});
});

describe('MapDataModel across projects', () => {
	const HOUR = 3_600_000;

	/** A project's read, answered from a script, with the cursor of every ask. */
	interface Scripted {
		read: MapReadSource;
		reads: Array<MapRead | Error | Promise<MapRead>>;
		asked: Array<number | null>;
	}

	/** A read that lands when the test says. */
	function later(): { read: Promise<MapRead>; land: (read: MapRead) => void } {
		let land!: (read: MapRead) => void;
		const read = new Promise<MapRead>((resolve) => {
			land = resolve;
		});
		return { read, land };
	}

	const scripted = (...reads: Array<MapRead | Error | Promise<MapRead>>): Scripted => {
		const script: Scripted = {
			reads,
			asked: [],
			read: (since) => {
				script.asked.push(since);
				const next = script.reads.shift() ?? new Error('Nothing scripted');
				return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
			},
		};
		return script;
	};

	/** Two small projects under their own prefixes: one live, with a family, and one quiet. */
	function boards(): { spe: BoardBuilder; pln: BoardBuilder } {
		const spe = new BoardBuilder(undefined, 'SPE');
		spe.add({ status: 'in_progress', started: spe.now - HOUR });
		const epic = spe.add({ type: 'epic', status: 'in_progress' });
		spe.add({ parentKey: epic.key, status: 'ready' });
		const pln = new BoardBuilder(undefined, 'PLN');
		pln.add({ status: 'ready' });
		pln.add({ status: 'done' });
		return { spe, pln };
	}

	const keysOf = (rows: Iterable<MapItemRow | string>): string[] => [...rows].map((row) => (typeof row === 'string' ? row : row.key)).sort();

	const drain = async (): Promise<void> => {
		for (let i = 0; i < 20; i++) await Promise.resolve();
	};

	/** Loads a Map of these projects, answering the layout when one is asked for, on a clock that a poll's worth of time passes on before every refresh. */
	async function loaded(projects: Array<[string, Scripted]>): Promise<{ model: MapDataModel; worker: ReturnType<typeof fakeWorker>; poll: () => Promise<boolean> }> {
		const worker = fakeWorker();
		const clock = { now: NOW };
		const model = new MapDataModel(projects.map(([ref, script]) => ({ ref, read: script.read })), () => worker, memoryCollapseStore(), () => clock.now);
		const loading = model.load(2);
		await drain();
		worker.pending.shift()?.();
		await loading;
		const poll = (): Promise<boolean> => {
			clock.now += 30_000;
			return model.refresh();
		};
		return { model, worker, poll };
	}

	const settle = async (worker: ReturnType<typeof fakeWorker>): Promise<void> => {
		await drain();
		worker.pending.shift()!();
		await drain();
	};

	it('lays out every project\'s rows together, once every read is in', async () => {
		const { spe, pln } = boards();
		const a = scripted(wholeRead(spe.rows));
		const b = scripted(wholeRead(pln.rows));
		const { model, worker } = await loaded([['acme/specboard', a], ['kim/planner', b]]);

		expect(a.asked).toEqual([null]);
		expect(b.asked).toEqual([null]);
		expect(worker.calls).toBe(1);
		expect(keysOf(worker.inputs[0]!.rows)).toEqual(keysOf([...spe.rows, ...pln.rows]));
		expect(model.state).toBe('ready');
		expect(keysOf(model.rows.values())).toEqual(keysOf([...spe.rows, ...pln.rows]));
		expect(model.layout!.regions.map((region) => region.key)).toEqual([spe.rows[1]!.key]);
		expect(model.failures.size).toBe(0);
		expect(model.retrying).toBe(false);
	});

	it('asks each project only what changed since its own cursor, and reads again only the one whose delta does not add up', async () => {
		const { spe, pln } = boards();
		const a = scripted(wholeRead(spe.rows, { cursor: 1_000 }));
		const b = scripted(wholeRead(pln.rows, { cursor: 2_000 }));
		const { model, worker, poll } = await loaded([['acme/specboard', a], ['kim/planner', b]]);

		const gone = spe.rows[0]!.key;
		const picked = { ...pln.rows[0]!, status: 'in_progress' as const, startedAt: iso(pln.now + 5000), timeAnchor: iso(pln.now + 5000) };
		a.reads.push(deltaRead([], spe.rows.length - 1), wholeRead(spe.rows.slice(1), { cursor: 3_000 }));
		b.reads.push(deltaRead([picked], pln.rows.length, { cursor: 4_000 }));

		expect(await poll()).toBe(true);
		expect(a.asked).toEqual([null, 1_000, null]);
		expect(b.asked).toEqual([null, 2_000]);
		await settle(worker);

		expect(model.rows.has(gone)).toBe(false);
		expect(model.rows.get(picked.key)).toBe(picked);
		expect([...model.changes!.removed]).toEqual([gone]);
		expect([...model.changes!.restyled]).toEqual([picked.key]);

		a.reads.push(deltaRead([], spe.rows.length - 1));
		b.reads.push(deltaRead([], pln.rows.length));
		await poll();
		expect(a.asked.at(-1)).toBe(3_000);
		expect(b.asked.at(-1)).toBe(4_000);
	});

	it('draws the rest when one project\'s first read fails, names it, and lays everything out afresh when it lands', async () => {
		const { spe, pln } = boards();
		const a = scripted(wholeRead(spe.rows));
		const b = scripted(new FetchError('HTTP 500: Internal Server Error', 500));
		const { model, worker, poll } = await loaded([['acme/specboard', a], ['kim/planner', b]]);

		expect(model.state).toBe('ready');
		expect(keysOf(model.rows.values())).toEqual(keysOf(spe.rows));
		expect([...model.failures]).toEqual([['kim/planner', { error: expect.objectContaining({ status: 500 }), unreadable: false, held: false }]]);
		expect(model.retrying).toBe(true);

		// Failing the same way: the report doesn't change, and the other project's read keeps the poll at full speed.
		const failures = model.failures;
		a.reads.push(deltaRead([], spe.rows.length));
		b.reads.push(new FetchError('HTTP 503: Service Unavailable', 503));
		expect(await poll()).toBe(true);
		expect(model.failures).toBe(failures);
		await drain();

		a.reads.push(deltaRead([], spe.rows.length));
		b.reads.push(wholeRead(pln.rows));
		expect(await poll()).toBe(true);
		expect(b.asked).toEqual([null, null, null]);
		// Its rows are nobody's news, and the scale fitted at load never saw them: a cold layout, cut to.
		expect(worker.inputs.at(-1)!.previous).toBeUndefined();
		await settle(worker);

		expect(model.changes).toBeNull();
		expect(keysOf(model.rows.values())).toEqual(keysOf([...spe.rows, ...pln.rows]));
		expect(model.failures.size).toBe(0);
		expect(model.retrying).toBe(false);

		// What changes in it next is news again.
		const picked = { ...pln.rows[0]!, status: 'in_progress' as const, startedAt: iso(pln.now + 5000), timeAnchor: iso(pln.now + 5000) };
		a.reads.push(deltaRead([], spe.rows.length));
		b.reads.push(deltaRead([picked], pln.rows.length));
		await poll();
		expect(worker.inputs.at(-1)!.previous).toBeDefined();
		await settle(worker);
		expect([...model.changes!.moved]).toEqual([picked.key]);
	});

	it('keeps drawing a project whose refresh fails, names it as held, and backs off only when no read lands', async () => {
		const { spe, pln } = boards();
		const a = scripted(wholeRead(spe.rows));
		const b = scripted(wholeRead(pln.rows));
		const { model, poll } = await loaded([['acme/specboard', a], ['kim/planner', b]]);
		const rows = model.rows;

		a.reads.push(deltaRead([], spe.rows.length));
		b.reads.push(new FetchError('HTTP 502: Bad Gateway', 502));
		expect(await poll()).toBe(true);
		expect(model.retrying).toBe(true);
		expect(model.failures.get('kim/planner')).toMatchObject({ unreadable: false, held: true });
		await drain();
		expect(model.rows).toBe(rows);

		a.reads.push(new Error('Failed to fetch'));
		b.reads.push(new Error('Failed to fetch'));
		expect(await poll()).toBe(false);
		expect(model.failures.get('acme/specboard')).toMatchObject({ unreadable: false, held: true });

		a.reads.push(deltaRead([], spe.rows.length));
		b.reads.push(deltaRead([], pln.rows.length));
		expect(await poll()).toBe(true);
		expect(model.failures.size).toBe(0);
		expect(model.retrying).toBe(false);
	});

	it('drops a project the person can no longer read for good, a 403 on the first read or a 404 on a later one, and lays out the rest afresh', async () => {
		const { spe, pln } = boards();
		const a = scripted(wholeRead(spe.rows));
		const b = scripted(wholeRead(pln.rows));
		const c = scripted(new FetchError('HTTP 403: Forbidden', 403));
		const { model, worker, poll } = await loaded([['acme/specboard', a], ['kim/planner', b], ['lee/other', c]]);

		expect(model.failures.get('lee/other')).toEqual({ error: expect.objectContaining({ status: 403 }), unreadable: true, held: false });
		expect(model.retrying).toBe(false);

		a.reads.push(deltaRead([], spe.rows.length));
		b.reads.push(new FetchError('HTTP 404: Not Found', 404));
		expect(await poll()).toBe(true);
		expect(worker.inputs.at(-1)!.previous).toBeUndefined();
		await settle(worker);

		expect(model.changes).toBeNull();
		expect(keysOf(model.rows.values())).toEqual(keysOf(spe.rows));
		expect([...model.failures.keys()]).toEqual(['kim/planner', 'lee/other']);
		expect(model.failures.get('kim/planner')).toMatchObject({ unreadable: true, held: false });

		a.reads.push(deltaRead([], spe.rows.length));
		await poll();
		expect(b.asked).toHaveLength(2);
		expect(c.asked).toHaveLength(1);
	});

	it('drops a project another view found it can\'t read: its rows leave in a fresh layout, it\'s never asked again, and a read of it still out is ignored', async () => {
		const { spe, pln } = boards();
		const out = later();
		const a = scripted(wholeRead(spe.rows));
		const b = scripted(wholeRead(pln.rows));
		const { model, worker, poll } = await loaded([['acme/specboard', a], ['kim/planner', b]]);
		expect(keysOf(model.rows.values())).toEqual(keysOf([...spe.rows, ...pln.rows]));

		// The planner's next read goes out, and the page learns it can't be read before it lands.
		a.reads.push(deltaRead([], spe.rows.length));
		b.reads.push(out.read);
		const polled = poll();
		await drain();
		model.drop('kim/planner');
		expect(model.failures.get('kim/planner')).toMatchObject({ unreadable: true, held: false });
		await settle(worker);

		expect(worker.inputs.at(-1)!.previous).toBeUndefined();
		expect(model.changes).toBeNull();
		expect(keysOf(model.rows.values())).toEqual(keysOf(spe.rows));

		// A delta that doesn't add up would be followed by a whole read, but not of a project dropped meanwhile.
		out.land(deltaRead([], pln.rows.length - 1));
		await polled;
		await drain();
		expect(b.asked).toHaveLength(2);
		expect(keysOf(model.rows.values())).toEqual(keysOf(spe.rows));
		expect(model.failures.get('kim/planner')).toMatchObject({ unreadable: true });

		a.reads.push(deltaRead([], spe.rows.length));
		await poll();
		expect(b.asked).toHaveLength(2);

		const failures = model.failures;
		model.drop('kim/planner');
		model.drop('nobody/here');
		expect(model.failures).toBe(failures);
	});

	it('is the error state only when every project\'s read fails, and names the first failure', async () => {
		const worker = fakeWorker();
		const a = scripted(new Error('HTTP 500: Internal Server Error'));
		const b = scripted(new FetchError('HTTP 404: Not Found', 404));
		const model = new MapDataModel([{ ref: 'acme/specboard', read: a.read }, { ref: 'kim/planner', read: b.read }], () => worker, memoryCollapseStore());
		await model.load(2);

		expect(model.state).toBe('error');
		expect(model.error!.message).toBe('HTTP 500: Internal Server Error');
		expect(model.failures.size).toBe(0);
		expect(worker.calls).toBe(0);
	});

	it('never drops the last project standing: a project\'s own Map holds what it has through a 404, backs off, and takes the next read as news', async () => {
		const { spe } = boards();
		const a = scripted(wholeRead(spe.rows));
		const { model, worker, poll } = await loaded([['acme/specboard', a]]);
		const rows = model.rows;

		a.reads.push(new FetchError('HTTP 404: Not Found', 404));
		expect(await poll()).toBe(false);
		expect(model.retrying).toBe(true);
		expect(model.rows).toBe(rows);
		expect(model.failures.get('acme/specboard')).toMatchObject({ unreadable: false, held: true });

		const picked = { ...spe.rows[2]!, status: 'in_progress' as const, startedAt: iso(spe.now + 5000), timeAnchor: iso(spe.now + 5000) };
		a.reads.push(deltaRead([picked], spe.rows.length));
		expect(await poll()).toBe(true);
		expect(a.asked).toHaveLength(3);
		expect(worker.inputs.at(-1)!.previous).toBeDefined();
		await settle(worker);
		expect([...model.changes!.moved]).toEqual([picked.key]);
		expect(model.failures.size).toBe(0);
	});

	it('drops a round that dispose overtook, without asking for the whole read its delta would have needed', async () => {
		const { spe, pln } = boards();
		const a = scripted(wholeRead(spe.rows, { cursor: 1_000 }));
		const b = scripted(wholeRead(pln.rows));
		const { model, worker, poll } = await loaded([['acme/specboard', a], ['kim/planner', b]]);
		const delta = later();
		a.reads.push(delta.read);
		b.reads.push(deltaRead([], pln.rows.length));

		const round = poll();
		await drain();
		model.dispose();
		// The count is one short: on its own, this delta would be followed by a read of the whole project.
		delta.land(deltaRead([], spe.rows.length - 1));

		expect(await round).toBe(true);
		await drain();
		expect(a.asked).toEqual([null, 1_000]);
		expect(worker.calls).toBe(1);
		expect(keysOf(model.rows.values())).toEqual(keysOf([...spe.rows, ...pln.rows]));
	});

	it('drops a round that a load overtook, and draws what the load read', async () => {
		const { spe, pln } = boards();
		const a = scripted(wholeRead(spe.rows, { cursor: 1_000 }));
		const b = scripted(wholeRead(pln.rows));
		const { model, worker, poll } = await loaded([['acme/specboard', a], ['kim/planner', b]]);
		const delta = later();
		const picked = { ...pln.rows[0]!, status: 'in_progress' as const, startedAt: iso(pln.now + 5000), timeAnchor: iso(pln.now + 5000) };
		a.reads.push(delta.read);
		b.reads.push(deltaRead([picked], pln.rows.length));

		const round = poll();
		await drain();
		a.reads.push(wholeRead(spe.rows.slice(1)));
		b.reads.push(wholeRead(pln.rows));
		const loading = model.load(2);
		delta.land(deltaRead([], spe.rows.length - 1));
		expect(await round).toBe(true);
		await drain();
		worker.pending.shift()!();
		await loading;

		// One read each for the first load, the round, and the reload: none for the round's delta that didn't add up.
		expect(a.asked).toEqual([null, 1_000, null]);
		expect(keysOf(model.rows.values())).toEqual(keysOf([...spe.rows.slice(1), ...pln.rows]));
		expect(model.rows.get(picked.key)).toEqual(pln.rows[0]);
		expect(model.changes).toBeNull();
		expect(worker.calls).toBe(2);
	});

	it('says which projects came back past the read cap', async () => {
		const { spe, pln } = boards();
		const a = scripted(wholeRead(spe.rows, { summarized: true }));
		const b = scripted(wholeRead(pln.rows));
		const { model } = await loaded([['acme/specboard', a], ['kim/planner', b]]);

		expect(model.summarized).toEqual(['acme/specboard']);
	});
});
