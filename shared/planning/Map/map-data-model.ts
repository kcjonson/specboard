import type { MapItemRow, MapRead } from '@specboard/core/map-read';
import type { ChangeCallback, Observable } from '@specboard/models';
import type { CollapseChoices, CollapseStore } from './collapse-store';
import type { MapLayoutWorker } from './layout/layout-worker-client';
import type { MapLayout, MapLayoutPrevious } from './layout/types';

export type MapLoadState = 'loading' | 'ready' | 'error';

export type MapReadSource = () => Promise<MapRead>;

/**
 * The Map's data: the whole-project read, laid out by the worker. It is an Observable,
 * so `useModel` and later layers (polling, selection, the summary strip) subscribe the
 * same way the board's models are subscribed to. Dots only ever arrive together: the
 * state flips to `ready` once the layout has settled, never earlier.
 */
export class MapDataModel implements Observable {
	state: MapLoadState = 'loading';
	error: Error | null = null;
	read: MapRead | null = null;
	/** Null until `ready`, and for a project with no items, which has nothing to place. */
	layout: MapLayout | null = null;
	rows: ReadonlyMap<string, MapItemRow> = new Map();
	/** Epoch ms the layout was computed for. */
	now = 0;
	/** The person's expand and collapse choices, which the layout takes as input. */
	collapse: CollapseChoices;

	private readonly listeners = new Set<ChangeCallback>();
	private readonly source: MapReadSource;
	private readonly createWorker: () => MapLayoutWorker;
	private readonly store: CollapseStore;
	private readonly clock: () => number;
	private worker: MapLayoutWorker | null = null;
	private aspect = 2;
	/** Bumped by every load and by dispose, so an answer that arrives late is dropped. */
	private generation = 0;

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
		const generation = ++this.generation;
		this.state = 'loading';
		this.error = null;
		this.emit();
		try {
			const read = await this.source();
			if (generation !== this.generation) return;
			const now = this.clock();
			let layout: MapLayout | null = null;
			if (read.items.length > 0) {
				this.worker ??= this.createWorker();
				({ layout } = await this.worker.layout({ rows: read.items, now, collapse: this.collapse, aspect }));
				if (generation !== this.generation) return;
			}
			this.read = read;
			this.rows = new Map(read.items.map((row) => [row.key, row]));
			this.layout = layout;
			this.now = now;
			this.state = 'ready';
		} catch (error) {
			if (generation !== this.generation) return;
			this.fail(error);
		}
		this.emit();
	}

	/**
	 * Collapses a region into its parent's dot, or expands a dot back into a region, and
	 * remembers the choice. The layout reruns as a local pass from the current positions,
	 * so the rest of the Map holds still; the Map stays ready while it runs.
	 */
	async setCollapsed(key: string, collapsed: boolean): Promise<void> {
		const { layout, read } = this;
		if (this.state !== 'ready' || !layout || !read || !this.worker) return;
		this.collapse = { ...this.collapse, [key]: collapsed };
		this.store.write(this.collapse);
		const generation = ++this.generation;
		const previous: MapLayoutPrevious = {
			frame: layout.frame,
			positions: Object.fromEntries(layout.nodes.map((node) => [node.key, { x: node.x, y: node.y }])),
			changed: [key],
		};
		try {
			const next = await this.worker.layout({ rows: read.items, now: this.now, collapse: this.collapse, aspect: this.aspect, previous });
			if (generation !== this.generation) return;
			this.layout = next.layout;
		} catch (error) {
			if (generation !== this.generation) return;
			this.fail(error);
		}
		this.emit();
	}

	retry(): Promise<void> {
		return this.load(this.aspect);
	}

	dispose(): void {
		this.generation++;
		this.worker?.terminate();
		this.worker = null;
		this.listeners.clear();
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
