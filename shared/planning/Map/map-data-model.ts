import type { MapItemRow, MapRead } from '@specboard/core/map-read';
import type { ChangeCallback, Observable } from '@specboard/models';
import type { MapLayoutWorker } from './layout/layout-worker-client';
import type { MapLayout } from './layout/types';

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

	private readonly listeners = new Set<ChangeCallback>();
	private readonly source: MapReadSource;
	private readonly createWorker: () => MapLayoutWorker;
	private readonly clock: () => number;
	private worker: MapLayoutWorker | null = null;
	private aspect = 2;
	/** Bumped by every load and by dispose, so an answer that arrives late is dropped. */
	private generation = 0;

	constructor(source: MapReadSource, createWorker: () => MapLayoutWorker, clock: () => number = Date.now) {
		this.source = source;
		this.createWorker = createWorker;
		this.clock = clock;
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
				({ layout } = await this.worker.layout({ rows: read.items, now, collapse: {}, aspect }));
				if (generation !== this.generation) return;
			}
			this.read = read;
			this.rows = new Map(read.items.map((row) => [row.key, row]));
			this.layout = layout;
			this.now = now;
			this.state = 'ready';
		} catch (error) {
			if (generation !== this.generation) return;
			this.error = error instanceof Error ? error : new Error(String(error));
			this.state = 'error';
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

	private emit(): void {
		for (const listener of [...this.listeners]) listener();
	}
}
