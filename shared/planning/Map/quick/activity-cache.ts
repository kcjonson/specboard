import { fetchClient } from '@specboard/fetch';
import type { Actor } from '@specboard/models';

/** One activity-log entry, as the notes endpoint returns it. */
export interface ActivityEntry {
	id: string;
	note: string;
	actor: Actor | null;
	createdAt: string;
}

export type Activity =
	| { state: 'loading' }
	/** `entry` is null for an item with no activity yet. */
	| { state: 'ready'; entry: ActivityEntry | null }
	| { state: 'error' };

/** Entries newest first; the quick card reads only the first. */
export type ActivitySource = (itemKey: string) => Promise<ActivityEntry[]>;

/** The item's newest activity entry; the Map's read carries no notes, so the quick card asks for one. */
export function createActivitySource(projectRef: string): ActivitySource {
	return (itemKey) => fetchClient.get<ActivityEntry[]>(`/api/projects/${projectRef}/items/${itemKey}/notes?limit=1`);
}

const LOADING: Activity = { state: 'loading' };

/**
 * The latest entry of each item's log, fetched the first time its card opens and kept
 * for the life of the view, so passing over the same dot twice asks once. A failure is
 * remembered only until the next ask, which retries.
 */
export class ActivityCache {
	private readonly entries = new Map<string, Activity>();
	private readonly listeners = new Set<() => void>();
	private readonly source: ActivitySource;

	constructor(source: ActivitySource) {
		this.source = source;
	}

	get(itemKey: string): Activity {
		return this.entries.get(itemKey) ?? LOADING;
	}

	/** Starts the fetch unless the item's entry is already here or on its way. */
	request(itemKey: string): void {
		const current = this.entries.get(itemKey);
		if (current && current.state !== 'error') return;
		this.entries.set(itemKey, LOADING);
		this.emit();
		this.source(itemKey).then(
			(entries) => this.settle(itemKey, { state: 'ready', entry: entries[0] ?? null }),
			() => this.settle(itemKey, { state: 'error' }),
		);
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private settle(itemKey: string, activity: Activity): void {
		this.entries.set(itemKey, activity);
		this.emit();
	}

	private emit(): void {
		for (const listener of [...this.listeners]) listener();
	}
}
