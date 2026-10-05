import { fetchClient } from '@specboard/fetch';
import type { ChangeCallback, Observable } from '@specboard/models';

/**
 * The keys of the items a search matches. The Map's read carries no descriptions
 * (deliberately, for payload), so the match is the board's own: the items list with a
 * search parameter, which tests title, description, and key at every depth.
 */
export type MapSearchSource = (query: string) => Promise<string[]>;

/** The list's cap: a search past it would have matched more than the Map could draw anyway. */
const SEARCH_LIMIT = 5000;

export function createSearchSource(projectRef: string): MapSearchSource {
	return async (query) => {
		const params = new URLSearchParams({ search: query, limit: String(SEARCH_LIMIT) });
		const rows = await fetchClient.get<Array<{ key: string }>>(`/api/projects/${projectRef}/items?${params.toString()}`);
		return rows.map((row) => row.key);
	};
}

export type MapSearchState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * One search at a time. A new query supersedes the one in flight (its answer is dropped
 * when it lands), and until the new answer arrives the last one keeps dimming, so a
 * keystroke that settles doesn't flash the whole Map back to full strength. Emptying the
 * query ends the search at once. The caller debounces, as the board's toolbar does.
 */
export class MapSearchModel implements Observable {
	state: MapSearchState = 'idle';
	/** The settled text the keys answer, or the one now loading. */
	query = '';
	/** Keys of the last answer; null when there is no search. */
	keys: ReadonlySet<string> | null = null;
	error: Error | null = null;

	private readonly listeners = new Set<ChangeCallback>();
	private readonly source: MapSearchSource;
	private generation = 0;

	constructor(source: MapSearchSource) {
		this.source = source;
	}

	on(event: 'change', callback: ChangeCallback): void {
		if (event === 'change') this.listeners.add(callback);
	}

	off(event: 'change', callback: ChangeCallback): void {
		if (event === 'change') this.listeners.delete(callback);
	}

	/** Searches for the trimmed text, or ends the search when it is empty. */
	setQuery(text: string): void {
		const query = text.trim();
		if (query === this.query && this.state !== 'error') return;
		this.query = query;
		if (query === '') {
			this.generation++;
			this.state = 'idle';
			this.keys = null;
			this.error = null;
			this.emit();
			return;
		}
		void this.run(query);
	}

	retry(): void {
		if (this.query !== '') void this.run(this.query);
	}

	dispose(): void {
		this.generation++;
		this.listeners.clear();
	}

	private async run(query: string): Promise<void> {
		const generation = ++this.generation;
		this.state = 'loading';
		this.error = null;
		this.emit();
		try {
			const keys = await this.source(query);
			if (generation !== this.generation) return;
			this.keys = new Set(keys);
			this.state = 'ready';
		} catch (error) {
			if (generation !== this.generation) return;
			this.keys = null;
			this.error = error instanceof Error ? error : new Error(String(error));
			this.state = 'error';
		}
		this.emit();
	}

	private emit(): void {
		for (const listener of [...this.listeners]) listener();
	}
}
