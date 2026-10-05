import type { MapItemRow, MapRead } from '@specboard/core/map-read';
import type { ChangeCallback, Observable } from '@specboard/models';
import type { CollapseChoices, CollapseStore } from './collapse-store';
import type { MapLayoutWorker } from './layout/layout-worker-client';
import { createTimeScale, edgeOf, timeToX } from './layout/time-scale';
import { TIME_CONSTANT } from './layout/constants';
import type { MapLayout, MapLayoutPrevious } from './layout/types';
import { NO_UPDATE, diffRows, changesAnything, type MapUpdate } from './map-update';
import type { RegionInput, RegionOutline } from './regions/outline';
import { gridStep } from './regions/region-outlines';

export type MapLoadState = 'loading' | 'ready' | 'error';

/** Reads the project: the whole of it, or given a cursor from an earlier read, only what changed since. */
export type MapReadSource = (since: number | null) => Promise<MapRead>;

/** Changes buffer, and apply at most this often (spec, Live updates and motion). */
export const APPLY_MS = 1000;

/**
 * A refresh that changed nothing the layout reads lays out again for time drift alone
 * once drift would slide recent work this far, in layout units: on a live board, every
 * twenty minutes or so rather than every poll, and at once when it goes quiet or wakes.
 */
export const DRIFT_STEP = 1;

/** The grid step the Map's extent is measured at, so the worker always traces it. */
const EXTENT_STEP = gridStep(0);

/**
 * A delta folded into the read it follows, or null when the delta's signals say the merge
 * can't be trusted: the project's count doesn't match (something was deleted), or its spec
 * links changed. Either way the whole project is read again.
 */
export function mergeRead(base: MapRead, delta: MapRead): MapRead | null {
	if (delta.specs !== base.specs) return null;
	const rows = new Map(base.items.map((row) => [row.key, row]));
	let added = 0;
	for (const row of delta.items) {
		if (!rows.has(row.key)) added++;
		rows.set(row.key, row);
	}
	if (delta.total !== base.total + added) return null;
	return { ...base, items: [...rows.values()], cursor: delta.cursor, total: delta.total, specs: delta.specs };
}

/**
 * The Map's data: the project read, laid out by the worker, and kept current. It is an
 * Observable, so `useModel` subscribes to it the way the board's models are subscribed to.
 * Dots only ever arrive together: the state flips to `ready` once the first layout has
 * settled, never earlier.
 *
 * A refresh asks for what changed since the last read and buffers it; at most once a
 * second the buffer applies as a local pass of the layout, and `changes` says what that
 * pass changed. That is the change notification the Map consumes: it never sees the
 * transport, so a push (SPE-203) can replace the poll that calls `refresh`.
 */
export class MapDataModel implements Observable {
	state: MapLoadState = 'loading';
	error: Error | null = null;
	/** The project as the Map shows it: the last whole read with every delta since folded in. */
	read: MapRead | null = null;
	/** Null until `ready`, and for a project with no items, which has nothing to place. */
	layout: MapLayout | null = null;
	rows: ReadonlyMap<string, MapItemRow> = new Map();
	/** Epoch ms the layout was computed for. */
	now = 0;
	/** What the latest pass changed in the data, which the Map moves to; null after a load or a collapse alone, which cut. A pass for time drift alone has an empty set, and glides. */
	changes: MapUpdate | null = null;
	/** When a read last landed, on the client's clock: the summary strip's freshness. */
	loadedAt: number | null = null;
	/** The last refresh failed; the Map holds what it has and the poll tries again. */
	retrying = false;
	/** The person's expand and collapse choices, which the layout takes as input. */
	collapse: CollapseChoices;
	/** The outline grid step the Map is drawing at, which the worker traces with each layout. */
	outlineStep = EXTENT_STEP;

	private readonly listeners = new Set<ChangeCallback>();
	private readonly source: MapReadSource;
	private readonly createWorker: () => MapLayoutWorker;
	private readonly store: CollapseStore;
	/** The wall clock the layout's `now` comes from; the view ticks off the same one. */
	readonly clock: () => number;
	private worker: MapLayoutWorker | null = null;
	/** Collapse toggles no settled layout reflects yet. */
	private readonly unsettled = new Set<string>();
	/** Data read but not yet in a settled layout: every read since, merged into the project. */
	private incoming: MapRead | null = null;
	private aspect = 2;
	/** Bumped by every load and by dispose, so a read that lands late is dropped. */
	private epoch = 0;
	/** Bumped by every pass (and every load), so only the newest pass's answer is kept. */
	private generation = 0;
	private inFlight = false;
	private fetching = false;
	private passStarted = -Infinity;
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(source: MapReadSource, createWorker: () => MapLayoutWorker, store: CollapseStore, clock: () => number = Date.now) {
		this.source = source;
		this.createWorker = createWorker;
		this.store = store;
		this.clock = clock;
		this.collapse = store.read();
	}

	get isEmpty(): boolean {
		return this.state === 'ready' && this.rows.size === 0;
	}

	on(event: 'change', callback: ChangeCallback): void {
		if (event === 'change') this.listeners.add(callback);
	}

	off(event: 'change', callback: ChangeCallback): void {
		if (event === 'change') this.listeners.delete(callback);
	}

	/** Reads the project and lays it out for a plot of this width over height. */
	async load(aspect: number): Promise<void> {
		this.aspect = aspect;
		this.unsettled.clear();
		this.incoming = null;
		this.stopTimer();
		const epoch = ++this.epoch;
		const generation = ++this.generation;
		this.inFlight = false;
		this.fetching = false;
		this.state = 'loading';
		this.error = null;
		this.emit();
		try {
			// The worker starts while the read is on the wire: loading its code and starting it took about 200 ms,
			// which sat between the read landing and the layout beginning when it started after.
			this.worker ??= this.createWorker();
			const read = await this.source(null);
			if (epoch !== this.epoch) return;
			const now = this.clock();
			let layout: MapLayout | null = null;
			if (read.items.length > 0) {
				({ layout } = await this.worker.layout({ rows: read.items, now, collapse: this.collapse, aspect, outlineSteps: this.outlineSteps() }));
				if (generation !== this.generation) return;
			}
			this.read = read;
			this.rows = new Map(read.items.map((row) => [row.key, row]));
			this.layout = layout;
			this.now = now;
			this.changes = null;
			this.loadedAt = this.clock();
			this.retrying = false;
			this.state = 'ready';
		} catch (error) {
			if (epoch !== this.epoch) return;
			this.fail(error);
		}
		this.emit();
	}

	/**
	 * Asks what changed since the last read and buffers it to apply. A delta whose signals
	 * don't add up (a deletion, a spec link) is followed by a read of the whole project.
	 * Resolves false when the read failed, so the poll can back off; the Map keeps what it
	 * has and says it is retrying.
	 */
	async refresh(): Promise<boolean> {
		const base = this.incoming ?? this.read;
		if (this.state !== 'ready' || !base || this.fetching) return true;
		const epoch = this.epoch;
		this.fetching = true;
		try {
			let read = await this.source(base.cursor);
			if (epoch !== this.epoch) return true;
			let merged = read.delta ? mergeRead(base, read) : read;
			if (!merged) {
				read = await this.source(null);
				if (epoch !== this.epoch) return true;
				merged = read;
			}
			this.incoming = merged;
			this.loadedAt = this.clock();
			this.retrying = false;
			this.schedule();
			this.emit();
			return true;
		} catch {
			if (epoch !== this.epoch) return true;
			this.retrying = true;
			this.emit();
			return false;
		} finally {
			if (epoch === this.epoch) this.fetching = false;
		}
	}

	/**
	 * Collapses a region into its parent's dot, or expands a dot back into a region, and
	 * remembers the choice. The layout reruns as a local pass from the current positions,
	 * so the rest of the Map holds still; the Map stays ready while it runs. A toggle
	 * doesn't wait out the buffer: it is the person's own act.
	 */
	setCollapsed(key: string, collapsed: boolean): Promise<void> {
		if (this.state !== 'ready' || !this.layout) return Promise.resolve();
		this.collapse = { ...this.collapse, [key]: collapsed };
		this.store.write(this.collapse);
		this.unsettled.add(key);
		this.stopTimer();
		return this.pass();
	}

	retry(): Promise<void> {
		return this.load(this.aspect);
	}

	dispose(): void {
		this.epoch++;
		this.generation++;
		this.stopTimer();
		this.worker?.terminate();
		this.worker = null;
		this.listeners.clear();
	}

	/** Applies what has buffered once a second has passed since the last pass began, and not while one is out. */
	private schedule(): void {
		if (this.inFlight || this.timer !== null || this.state !== 'ready' || !this.incoming) return;
		const wait = this.passStarted + APPLY_MS - this.clock();
		if (wait > 0) {
			this.timer = setTimeout(() => {
				this.timer = null;
				this.schedule();
			}, wait);
			return;
		}
		void this.pass();
	}

	/**
	 * One local pass from the last settled layout, carrying everything not yet in one:
	 * every collapse toggle, and the newest data with what changed against what the Map
	 * shows. A newer pass supersedes it, and carries all of that too. When nothing the
	 * layout reads changed and drift hasn't built up, the new rows go out on the same layout.
	 */
	private async pass(): Promise<void> {
		const settled = this.layout;
		const incoming = this.incoming;
		const read = incoming ?? this.read!;
		const rows = incoming ? new Map(read.items.map((row) => [row.key, row])) : this.rows;
		const changes = incoming ? diffRows(this.rows, rows) : NO_UPDATE;
		const toggled = [...this.unsettled];
		const generation = ++this.generation;
		this.passStarted = this.clock();
		// A toggle alone cuts rather than glides, so it doesn't move the clock either: drift waits for data.
		const now = incoming ? this.clock() : this.now;
		const moving = [...changes.added, ...changes.moved];
		const relayout = toggled.length > 0 || moving.length > 0 || changes.removed.size > 0 || this.drifted(rows, now);
		if (!relayout && !changesAnything(changes)) {
			// An idle poll: only the cursor moved. The Map is already showing all of it.
			this.read = read;
			if (this.incoming === incoming) this.incoming = null;
			this.schedule();
			return;
		}
		let layout = settled;
		if (relayout && read.items.length > 0) {
			this.inFlight = true;
			const previous: MapLayoutPrevious | undefined = settled
				? { frame: settled.frame, positions: Object.fromEntries(settled.nodes.map((node) => [node.key, { x: node.x, y: node.y }])), changed: [...new Set([...toggled, ...moving])] }
				: undefined;
			try {
				this.worker ??= this.createWorker();
				({ layout } = await this.worker.layout({ rows: read.items, now, collapse: this.collapse, aspect: this.aspect, previous, outlineSteps: this.outlineSteps() }));
			} catch (error) {
				if (generation !== this.generation) return;
				this.inFlight = false;
				this.fail(error);
				this.emit();
				return;
			}
			if (generation !== this.generation) return;
			this.inFlight = false;
		} else if (read.items.length === 0) {
			layout = null;
		}
		for (const key of toggled) this.unsettled.delete(key);
		if (this.incoming === incoming) this.incoming = null;
		this.read = read;
		this.rows = rows;
		this.layout = layout;
		if (layout !== settled) this.now = now;
		this.changes = incoming ? changes : null;
		this.emit();
		this.schedule();
	}

	/**
	 * Whether time alone has moved the scale enough to show: how far recent work (a time
	 * constant back from the edge) would slide on a scale moved to `now`.
	 */
	private drifted(rows: ReadonlyMap<string, MapItemRow>, now: number): boolean {
		const scale = this.layout?.frame.scale;
		if (!scale) return false;
		let newest = -Infinity;
		for (const row of rows.values()) newest = Math.max(newest, Date.parse(row.timeAnchor));
		const moved = createTimeScale(edgeOf(newest, now), scale.times, scale.unit);
		const probe = scale.edge - TIME_CONSTANT;
		return Math.abs(timeToX(moved, probe) - timeToX(scale, probe)) >= DRIFT_STEP;
	}

	/** Region outlines at one grid step, traced by the worker so a zoom never stalls the main thread. */
	traceOutlines(inputs: readonly RegionInput[], step: number): Promise<RegionOutline[]> {
		this.worker ??= this.createWorker();
		return this.worker.outlines(inputs, step);
	}

	private outlineSteps(): number[] {
		return this.outlineStep === EXTENT_STEP ? [EXTENT_STEP] : [EXTENT_STEP, this.outlineStep];
	}

	private stopTimer(): void {
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
	}

	private fail(error: unknown): void {
		// A worker that failed is dead for good, so Retry starts a fresh one.
		this.worker?.terminate();
		this.worker = null;
		this.error = error instanceof Error ? error : new Error(String(error));
		this.state = 'error';
	}

	private emit(): void {
		for (const listener of [...this.listeners]) listener();
	}
}
