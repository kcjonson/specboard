import { FetchError } from '@specboard/fetch';
import type {
	ChangeCallback,
	CollectionMeta,
	FetchOptions,
	ItemModel,
	ItemsCollection,
	ItemsFilter,
	ItemsSource,
	ItemStatus,
	Observable,
} from '@specboard/models';

/** A project the person can no longer read (removed from it, or it was deleted) answers 403 or 404. */
function unreadable(source: ItemsCollection): boolean {
	const { error } = source.$meta;
	return error instanceof FetchError && (error.status === 403 || error.status === 404);
}

/**
 * Several projects' items read as one (docs/specs/multi-project-view.md, decision 8).
 * Each project keeps its own ItemsCollection, windows and all, against its own
 * endpoints; this answers the views' reads across them, and fans out everything that
 * loads: fetch, setFilter, ensureLimit, and loadMore (to the projects that have more).
 *
 * Within a status the projects are interleaved round-robin by their own order: every
 * project's first item, then every project's second, ties going to the order the
 * projects were chosen in (decision 9). Ranks are per project, so sorting on them would
 * mix the projects arbitrarily; this keeps each one's order and brings each one's top
 * work near the top.
 *
 * A project whose load is refused with a 403 or 404 is dropped: it stops counting toward
 * anything here, is never asked again, and `dropped` names it so the view can say so.
 * Any other failure is an error of the whole, as it would be on one project's board.
 */
export class MergedItems implements ItemsSource, Observable {
	private readonly sources: readonly ItemsCollection[];

	/** `sources` in the order the projects were chosen. */
	constructor(sources: readonly ItemsCollection[]) {
		this.sources = sources;
	}

	/** The projects still in the view. */
	private get live(): ItemsCollection[] {
		return this.sources.filter((source) => !unreadable(source));
	}

	/** Refs of the projects dropped for answering 403 or 404, in the order chosen. */
	get dropped(): string[] {
		return this.sources.filter(unreadable).map((source) => source.projectRef);
	}

	on(event: 'change', callback: ChangeCallback): void {
		for (const source of this.sources) source.on(event, callback);
	}

	off(event: 'change', callback: ChangeCallback): void {
		for (const source of this.sources) source.off(event, callback);
	}

	/** Each project's own counter only rises, so their sum moves whenever any project changes. */
	get version(): number {
		return this.sources.reduce((sum, source) => sum + source.version, 0);
	}

	/**
	 * Working while any project is, and in error while any project still shown is. Fetched
	 * only once every project shown has been, so the first render waits for all of them
	 * rather than reshuffling the interleave as each one lands.
	 */
	get $meta(): CollectionMeta {
		const live = this.live;
		const fetched = live.map((source) => source.$meta.lastFetched);
		return {
			working: live.some((source) => source.$meta.working),
			error: live.find((source) => source.$meta.error !== null)?.$meta.error ?? null,
			lastFetched: fetched.length > 0 && fetched.every((at): at is number => at !== null) ? Math.max(...fetched) : null,
		};
	}

	get filterActive(): boolean {
		return this.live.some((source) => source.filterActive);
	}

	byStatus(status: ItemStatus): ItemModel[] {
		const lists = this.live.map((source) => source.byStatus(status));
		const depth = Math.max(0, ...lists.map((list) => list.length));
		const merged: ItemModel[] = [];
		for (let position = 0; position < depth; position++) {
			for (const list of lists) {
				const item = list[position];
				if (item) merged.push(item);
			}
		}
		return merged;
	}

	/** The first loaded item that matches, in the order the projects were chosen. */
	find(predicate: (item: ItemModel) => boolean): ItemModel | undefined {
		for (const source of this.live) {
			const item = source.find(predicate);
			if (item) return item;
		}
		return undefined;
	}

	loadedFor(status: ItemStatus): number {
		return this.live.reduce((sum, source) => sum + source.loadedFor(status), 0);
	}

	totalFor(status: ItemStatus): number {
		return this.live.reduce((sum, source) => sum + source.totalFor(status), 0);
	}

	hasMore(status: ItemStatus): boolean {
		return this.live.some((source) => source.hasMore(status));
	}

	/** Widens the window of every project with more in this status by `count`, the page each would grow by alone. */
	async loadMore(status: ItemStatus, count: number): Promise<void> {
		await Promise.all(this.live.filter((source) => source.hasMore(status)).map((source) => source.loadMore(status, count)));
	}

	/** Makes every project's windows at least `limit` rows wide, as a view with a larger page size takes over. */
	async ensureLimit(limit: number): Promise<void> {
		await Promise.all(this.live.map((source) => source.ensureLimit(limit)));
	}

	async setFilter(filter: ItemsFilter): Promise<void> {
		await Promise.all(this.live.map((source) => source.setFilter(filter)));
	}

	async fetch(options?: FetchOptions): Promise<void> {
		await Promise.all(this.live.map((source) => source.fetch(options)));
	}
}
