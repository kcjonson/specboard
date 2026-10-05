import { decodeMapChanges, type MapChange, type MapChangesWire } from '@specboard/core/map-changes';
import { fetchClient } from '@specboard/fetch';
import type { ChangeCallback, Observable } from '@specboard/models';

/**
 * Where the changes come from and where the baseline goes. A source of its own so a test
 * can stand one in, and so the model never learns which request carries what.
 */
export interface ChangesSource {
	/** The person's baseline, the read's time, and what changed since the baseline. */
	read(): Promise<{ baseline: number | null; readAt: number; changes: MapChange[] }>;
	/**
	 * Moves the baseline forward to `readAt`. `keepalive` is for a request sent as the
	 * page goes away: the browser finishes it after the page is gone.
	 */
	advance(readAt: number, options: { keepalive: boolean }): Promise<void>;
}

export function createChangesSource(projectRef: string): ChangesSource {
	return {
		read: async () => decodeMapChanges(await fetchClient.get<MapChangesWire>(`/api/projects/${projectRef}/map/changes`)),
		advance: async (readAt, { keepalive }) => {
			await fetchClient.post(`/api/projects/${projectRef}/map/seen`, { readAt }, { keepalive });
		},
	};
}

export type ChangesState = 'loading' | 'ready' | 'error';

/**
 * Since your last visit (spec, Since your last visit): the changes waiting for this
 * person, and the baseline they are counted from. The baseline moves when the person
 * marks everything seen or leaves the Map, always to the read's time the server gave, never
 * to the client's clock, and the server keeps it forward-only whatever order the moves
 * arrive in. A first visit has no baseline and nothing to show; it sets one at once.
 *
 * It's the person's own bookmark in the project, not a measurement of anything: nothing
 * here is logged, counted, or sent anywhere but that one request.
 */
export class MapChangesModel implements Observable {
	state: ChangesState = 'loading';
	error: Error | null = null;
	/** When the person last looked, epoch ms; null before the read lands and on a first visit. */
	baseline: number | null = null;
	/** The moment this read is good up to, epoch ms; what the baseline moves to. */
	readAt = 0;
	/** What changed since the baseline, oldest first; empty once everything is marked seen. */
	changes: readonly MapChange[] = [];

	private readonly listeners = new Set<ChangeCallback>();
	private readonly source: ChangesSource;
	/** The read time the baseline has been asked to move to, so a leave after a mark doesn't ask twice. */
	private requested = 0;
	private generation = 0;

	constructor(source: ChangesSource) {
		this.source = source;
	}

	on(event: 'change', callback: ChangeCallback): void {
		if (event === 'change') this.listeners.add(callback);
	}

	off(event: 'change', callback: ChangeCallback): void {
		if (event === 'change') this.listeners.delete(callback);
	}

	async load(): Promise<void> {
		const generation = ++this.generation;
		this.state = 'loading';
		this.error = null;
		this.emit();
		try {
			const read = await this.source.read();
			if (generation !== this.generation) return;
			this.baseline = read.baseline;
			this.readAt = read.readAt;
			this.changes = read.changes;
			this.requested = 0;
			this.state = 'ready';
			// A first visit has nothing to show and sets the baseline now, so the next visit has one to count from.
			if (read.baseline === null) this.advance({ keepalive: false });
		} catch (error) {
			if (generation !== this.generation) return;
			this.error = error instanceof Error ? error : new Error(String(error));
			this.state = 'error';
		}
		this.emit();
	}

	/** Mark all seen: nothing is waiting any more, and the baseline moves up to what was read. */
	markSeen(): void {
		if (this.state !== 'ready') return;
		this.baseline = this.readAt;
		this.changes = [];
		this.emit();
		this.advance({ keepalive: false });
	}

	/**
	 * The person is leaving the Map: another view, another page, or the tab closing. Asks
	 * for the baseline to move to what this Map had read, unless it already has. The
	 * request is a fetch with `keepalive`, which carries the CSRF token like every other
	 * write and which the browser completes after the page is gone, where `sendBeacon`
	 * can't send the token's header (the API would have to give up CSRF protection on the
	 * route) and unload handlers aren't reliable.
	 */
	leave(): void {
		this.generation++;
		this.advance({ keepalive: true });
	}

	private advance(options: { keepalive: boolean }): void {
		if (this.state !== 'ready' || this.readAt <= this.requested) return;
		const readAt = this.readAt;
		const before = this.requested;
		this.requested = readAt;
		// A move that failed is asked for again by the next one (the leave, after a failed mark).
		this.source.advance(readAt, options).catch(() => {
			if (this.requested === readAt) this.requested = before;
		});
	}

	private emit(): void {
		for (const listener of [...this.listeners]) listener();
	}
}
