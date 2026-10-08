import type { MapItemRow, MapRead } from '@specboard/core/map-read';
import { FetchError } from '@specboard/fetch';
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

/** Reads a project: the whole of it, or given a cursor from an earlier read, only what changed since. */
export type MapReadSource = (since: number | null) => Promise<MapRead>;

/** One project on the Map: where its read comes from, and the ref its failures go by. */
export interface MapProjectSource {
	ref: string;
	read: MapReadSource;
}

/** A project whose last read failed. Unless it is unreadable, the next poll asks it again. */
export interface MapProjectFailure {
	error: Error;
	/** It answered 403 or 404: the person can no longer read it, so it has left the Map for good. */
	unreadable: boolean;
	/** The Map still draws what it last read of the project. Neither this nor `unreadable` means the Map has never drawn it. */
	held: boolean;
}

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

/** A non-member gets 403 and a deleted project 404: either way the person can't read it. */
const isUnreadable = (error: Error): boolean => error instanceof FetchError && (error.status === 403 || error.status === 404);

/** One project's reads, kept current against its own cursor. */
interface ProjectReads {
	ref: string;
	read: MapReadSource;
	/** The newest read: the last whole one with every delta since folded in. Null until one lands, and once the project is dropped. */
	latest: MapRead | null;
	/** Why its last read failed; null once one lands. */
	failure: MapProjectFailure | null;
}

/**
 * The Map's data: every project's read, laid out together by the worker, and kept
 * current. A project's own Map reads one project; the combined view reads several
 * (multi-project-view.md, decision 10), each against its own cursor, and their rows are
 * one set, since every item key is unique across the Map. It is an Observable, so
 * `useModel` subscribes to it the way the board's models are subscribed to. Dots only
 * ever arrive together: the state flips to `ready` once the first layout has settled,
 * never earlier.
 *
 * A refresh asks every project what changed since its last read and buffers it; at most
 * once a second the buffer applies as a local pass of the layout, and `changes` says
 * what that pass changed. That is the change notification the Map consumes: it never
 * sees the transport, so a push (SPE-203) can replace the poll that calls `refresh`.
 */
export class MapDataModel implements Observable {
	state: MapLoadState = 'loading';
	error: Error | null = null;
	/** Null until `ready`, and for a Map with no items, which has nothing to place. */
	layout: MapLayout | null = null;
	rows: ReadonlyMap<string, MapItemRow> = new Map();
	/** The projects whose read, as the Map shows it, passed the read cap and came back with finished families folded. */
	summarized: readonly string[] = [];
	/** Every project whose last read failed, by ref. A new map only when which projects, or how they failed, changes. */
	failures: ReadonlyMap<string, MapProjectFailure> = new Map();
	/** Epoch ms the layout was computed for. */
	now = 0;
	/** What the latest pass changed in the data, which the Map moves to; null after a load or a collapse alone, which cut. A pass for time drift alone has an empty set, and glides. */
	changes: MapUpdate | null = null;
	/** When a read last landed, on the client's clock: the summary strip's freshness. */
	loadedAt: number | null = null;
	/** A read failed; the Map holds what it has and the poll tries again. */
	retrying = false;
	/** The person's expand and collapse choices, which the layout takes as input. */
	collapse: CollapseChoices;
	/** The outline grid step the Map is drawing at, which the worker traces with each layout. */
	outlineStep = EXTENT_STEP;

	private readonly listeners = new Set<ChangeCallback>();
	private readonly projects: ProjectReads[];
	private readonly createWorker: () => MapLayoutWorker;
	private readonly store: CollapseStore;
	/** The wall clock the layout's `now` comes from; the view ticks off the same one. */
	readonly clock: () => number;
	private worker: MapLayoutWorker | null = null;
	/** Collapse toggles no settled layout reflects yet. */
	private readonly unsettled = new Set<string>();
	/** Bumped by every round of reads that lands. The rows shown came from round `applied`; while the two differ, data is waiting for a pass. */
	private received = 0;
	private applied = 0;
	/** The last round a whole project's rows arrived or left in; the pass that applies it lays everything out afresh. */
	private reshapedAt = 0;
	private aspect = 2;
	/** Bumped by every load and by dispose, so a read that lands late is dropped. */
	private epoch = 0;
	/** Bumped by every pass (and every load), so only the newest pass's answer is kept. */
	private generation = 0;
	private inFlight = false;
	private fetching = false;
	private passStarted = -Infinity;
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(sources: readonly MapProjectSource[], createWorker: () => MapLayoutWorker, store: CollapseStore, clock: () => number = Date.now) {
		this.projects = sources.map(({ ref, read }) => ({ ref, read, latest: null, failure: null }));
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

	/**
	 * Reads every project and lays them out for a plot of this width over height. The Map
	 * is ready once any project's read lands; it fails only when every one does.
	 */
	async load(aspect: number): Promise<void> {
		this.aspect = aspect;
		this.unsettled.clear();
		this.stopTimer();
		const epoch = ++this.epoch;
		const generation = ++this.generation;
		this.inFlight = false;
		this.fetching = false;
		this.state = 'loading';
		this.error = null;
		this.emit();
		try {
			// The worker starts while the reads are on the wire: loading its code and starting it took about 200 ms,
			// which sat between the read landing and the layout beginning when it started after.
			this.worker ??= this.createWorker();
			const projects = this.readable();
			const reads = await Promise.allSettled(projects.map((project) => project.read(null)));
			if (epoch !== this.epoch) return;
			const rejected = reads.filter((read) => read.status === 'rejected');
			if (rejected.length > 0 && rejected.length === reads.length) throw rejected[0]!.reason;
			const { failed } = this.settle(projects, reads);
			const { rows, summarized } = this.union();
			const now = this.clock();
			let layout: MapLayout | null = null;
			if (rows.size > 0) {
				({ layout } = await this.worker.layout({ rows: [...rows.values()], now, collapse: this.collapse, aspect, outlineSteps: this.outlineSteps() }));
				if (generation !== this.generation) return;
			}
			this.applied = this.received;
			this.rows = rows;
			this.summarized = summarized;
			this.layout = layout;
			this.now = now;
			this.changes = null;
			this.loadedAt = this.clock();
			this.retrying = failed;
			this.state = 'ready';
		} catch (error) {
			if (epoch !== this.epoch) return;
			this.fail(error);
		}
		this.emit();
	}

	/**
	 * Asks every project what changed since its own last read and buffers it to apply. A
	 * delta whose signals don't add up (a deletion, a spec link) is followed by a read of
	 * that whole project, and a project with nothing on the Map yet is read whole. When a
	 * read fails the Map keeps what it has and says it is retrying. Resolves false when no
	 * read landed, so the poll backs off when the server is in trouble, not when one
	 * project is.
	 */
	async refresh(): Promise<boolean> {
		if (this.state !== 'ready' || this.fetching) return true;
		const epoch = this.epoch;
		this.fetching = true;
		try {
			const projects = this.readable();
			const reads = await Promise.allSettled(projects.map((project) => this.readSince(project, epoch)));
			if (epoch !== this.epoch) return true;
			const { landed, failed, reshaped } = this.settle(projects, reads);
			this.retrying = failed;
			if (landed) {
				this.received++;
				if (reshaped) this.reshapedAt = this.received;
				this.loadedAt = this.clock();
				this.schedule();
			}
			this.emit();
			return landed;
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

	/** Every project the Map still reads: all of them but the ones it dropped. */
	private readable(): ProjectReads[] {
		return this.projects.filter((project) => !project.failure?.unreadable);
	}

	/** What changed in a project since its own cursor, folded into what the Map has of it; all of it when the Map has nothing of it yet. */
	private async readSince(project: ProjectReads, epoch: number): Promise<MapRead> {
		const base = project.latest;
		if (!base) return project.read(null);
		const read = await project.read(base.cursor);
		// A load or dispose has overtaken this round: nothing waits for the whole read a failed merge would need.
		if (epoch !== this.epoch) return base;
		return (read.delta ? mergeRead(base, read) : read) ?? project.read(null);
	}

	/**
	 * Takes in one round of reads. A project whose read landed has it; one whose read failed
	 * keeps what it had, and the poll asks again. A 403 or 404 drops the project for good,
	 * but only in a round where another project's read landed: the last project standing
	 * holds what it has and keeps being asked, which is what a project's own Map does
	 * when its read fails. `reshaped` says a project's rows arrived (the first of its reads
	 * to land had any) or left (it was dropped), which a project's own Map never sees.
	 */
	private settle(projects: readonly ProjectReads[], reads: readonly PromiseSettledResult<MapRead>[]): { landed: boolean; failed: boolean; reshaped: boolean } {
		const landed = reads.some((read) => read.status === 'fulfilled');
		let failed = false;
		let reshaped = false;
		projects.forEach((project, i) => {
			const read = reads[i]!;
			if (read.status === 'fulfilled') {
				if (!project.latest && read.value.items.length > 0) reshaped = true;
				project.latest = read.value;
				project.failure = null;
				return;
			}
			const error = read.reason instanceof Error ? read.reason : new Error(String(read.reason));
			if (landed && isUnreadable(error)) {
				if (project.latest && project.latest.items.length > 0) reshaped = true;
				project.latest = null;
				project.failure = { error, unreadable: true, held: false };
			} else {
				failed = true;
				project.failure = { error, unreadable: false, held: project.latest !== null };
			}
		});
		const failures = new Map<string, MapProjectFailure>();
		for (const project of this.projects) if (project.failure) failures.set(project.ref, project.failure);
		const same = failures.size === this.failures.size && [...failures].every(([ref, failure]) => {
			const was = this.failures.get(ref);
			return was !== undefined && was.unreadable === failure.unreadable && was.held === failure.held;
		});
		if (!same) this.failures = failures;
		return { landed, failed, reshaped };
	}

	/** Every project's newest rows as one set, and the projects whose read came back summarized. */
	private union(): { rows: Map<string, MapItemRow>; summarized: string[] } {
		const rows = new Map<string, MapItemRow>();
		const summarized: string[] = [];
		for (const project of this.projects) {
			if (!project.latest) continue;
			for (const row of project.latest.items) rows.set(row.key, row);
			if (project.latest.summarized) summarized.push(project.ref);
		}
		return { rows, summarized };
	}

	/** Applies what has buffered once a second has passed since the last pass began, and not while one is out. */
	private schedule(): void {
		if (this.inFlight || this.timer !== null || this.state !== 'ready' || this.received === this.applied) return;
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
		const round = this.received;
		const fresh = round !== this.applied;
		// A whole project's rows arriving or leaving are nobody's news, and the time scale fitted at load may not
		// hold them: everything is laid out afresh, and the Map cuts to it.
		const reshaped = fresh && this.reshapedAt > this.applied;
		const { rows, summarized } = fresh ? this.union() : { rows: this.rows, summarized: this.summarized };
		const changes = fresh ? diffRows(this.rows, rows) : NO_UPDATE;
		const toggled = [...this.unsettled];
		const generation = ++this.generation;
		this.passStarted = this.clock();
		// A toggle alone cuts rather than glides, so it doesn't move the clock either: drift waits for data.
		const now = fresh ? this.clock() : this.now;
		const moving = [...changes.added, ...changes.moved];
		const relayout = reshaped || toggled.length > 0 || moving.length > 0 || changes.removed.size > 0 || this.drifted(rows, now);
		if (!relayout && !changesAnything(changes)) {
			// An idle poll: only the cursors moved. The Map is already showing all of it.
			this.applied = round;
			this.schedule();
			return;
		}
		let layout = settled;
		if (relayout && rows.size > 0) {
			this.inFlight = true;
			const previous: MapLayoutPrevious | undefined = settled && !reshaped
				? { frame: settled.frame, positions: Object.fromEntries(settled.nodes.map((node) => [node.key, { x: node.x, y: node.y }])), changed: [...new Set([...toggled, ...moving])] }
				: undefined;
			try {
				this.worker ??= this.createWorker();
				({ layout } = await this.worker.layout({ rows: [...rows.values()], now, collapse: this.collapse, aspect: this.aspect, previous, outlineSteps: this.outlineSteps() }));
			} catch (error) {
				if (generation !== this.generation) return;
				this.inFlight = false;
				this.fail(error);
				this.emit();
				return;
			}
			if (generation !== this.generation) return;
			this.inFlight = false;
		} else if (rows.size === 0) {
			layout = null;
		}
		for (const key of toggled) this.unsettled.delete(key);
		this.applied = round;
		this.rows = rows;
		this.summarized = summarized;
		this.layout = layout;
		if (layout !== settled) this.now = now;
		this.changes = fresh && !reshaped ? changes : null;
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
