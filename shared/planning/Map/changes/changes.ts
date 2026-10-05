import { MAP_CHANGE_KINDS, type MapChange, type MapChangeKind } from '@specboard/core/map-changes';
import type { MapItemRow } from '@specboard/core/map-read';
import { formatDate, formatDateTime } from '../../utils/time';

/**
 * Since your last visit, as the Map shows it (spec, Since your last visit): the changes
 * grouped by item, in the order they happened, with the words for the summary strip and
 * for a changed item's card. Nothing here touches the layout or the network.
 */

/** One changed item: all of its changes, oldest first, and the time of the latest. */
export interface ChangedItem {
	key: string;
	changes: readonly MapChange[];
	/** Epoch ms of the item's latest change, which is where it falls in the order. */
	at: number;
}

const keyNumber = (key: string): number => Number(key.slice(key.lastIndexOf('-') + 1));

/**
 * The items that changed, in the order it happened: by each item's latest change, oldest
 * first, the item number breaking a tie. `present` says which items the Map has, since a
 * change can name an item the read doesn't carry (filed between the two requests, or
 * folded away past the read cap).
 */
export function changedItems(changes: readonly MapChange[], present: (key: string) => boolean): ChangedItem[] {
	const byKey = new Map<string, MapChange[]>();
	for (const change of changes) {
		if (!present(change.key)) continue;
		const list = byKey.get(change.key);
		if (list) list.push(change);
		else byKey.set(change.key, [change]);
	}
	const items = [...byKey].map(([key, list]): ChangedItem => {
		const sorted = list.sort((a, b) => a.at - b.at);
		return { key, changes: sorted, at: sorted[sorted.length - 1]!.at };
	});
	return items.sort((a, b) => a.at - b.at || keyNumber(a.key) - keyNumber(b.key));
}

/** The items the at-rest labels go to: the most recent changes, newest first. */
export const RECENT_LABELS = 8;

export function recentChanged(items: readonly ChangedItem[], count = RECENT_LABELS): Set<string> {
	return new Set(items.slice(-count).map((item) => item.key));
}

const SUMMARY_WORDS: Record<MapChangeKind, (count: number) => string> = {
	finished: (count) => `${count} finished`,
	worked_on: (count) => `${count} worked on`,
	filed: (count) => `${count} filed`,
	blocked: (count) => `${count} blocked`,
	question: (count) => (count === 1 ? '1 question' : `${count} questions`),
	pr_opened: (count) => (count === 1 ? '1 PR opened' : `${count} PRs opened`),
};

/** Items per kind, in the strip's order, leaving out kinds nothing changed by. An item with two kinds counts under both. */
export function summaryCounts(items: readonly ChangedItem[]): Array<{ kind: MapChangeKind; count: number }> {
	const counts = new Map<MapChangeKind, number>();
	for (const item of items) {
		for (const kind of new Set(item.changes.map((change) => change.kind))) counts.set(kind, (counts.get(kind) ?? 0) + 1);
	}
	return MAP_CHANGE_KINDS.filter((kind) => counts.has(kind)).map((kind) => ({ kind, count: counts.get(kind)! }));
}

/** The strip's since summary at three lengths, longest first. */
export interface SummaryText {
	/** `11 finished, 1 worked on, 9 filed`. */
	full: string;
	/** The first kind and how many more there are: `11 finished, +2 more kinds`. */
	lead: string;
	/** Items, whatever their kinds: `19 items changed`. */
	total: string;
}

export function summaryText(items: readonly ChangedItem[]): SummaryText {
	const counts = summaryCounts(items);
	const words = counts.map(({ kind, count }) => SUMMARY_WORDS[kind](count));
	const full = words.join(', ');
	if (counts.length < 2) return { full, lead: full, total: full };
	const more = counts.length - 1;
	return {
		full,
		lead: `${words[0]}, +${more} more ${more === 1 ? 'kind' : 'kinds'}`,
		total: `${items.length} ${items.length === 1 ? 'item' : 'items'} changed`,
	};
}

const isoOf = (ms: number): string => new Date(ms).toISOString();

/** The baseline as a date for the bar and the strip: `Sep 19`. */
export function baselineDate(baseline: number): string {
	return formatDate(isoOf(baseline));
}

export function barTitle(baseline: number): string {
	return `Since your last visit, ${baselineDate(baseline)}`;
}

/**
 * What a changed item's card says: one line per change, in the order they happened, each
 * with its time (`Finished Oct 3, 3:12 PM`). A filed item says who filed it, and an
 * agent-filed one what it was discovered from.
 */
export function changeLines(item: ChangedItem, row: MapItemRow, rows: ReadonlyMap<string, MapItemRow>): string[] {
	const lines: string[] = [];
	for (const { kind, at } of item.changes) {
		const when = formatDateTime(isoOf(at));
		switch (kind) {
			case 'finished': lines.push(`Finished ${when}`); break;
			case 'worked_on': lines.push(`Worked on ${when}`); break;
			case 'filed':
				lines.push(row.originActorType === 'agent' ? `Filed by an agent ${when}` : `Filed ${when}`);
				if (row.originActorType === 'agent' && row.discoveredFromKey) {
					const source = rows.get(row.discoveredFromKey);
					lines.push(`Discovered from ${row.discoveredFromKey}${source ? ` ${source.title}` : ''}`);
				}
				break;
			case 'blocked': lines.push(`${row.blockers.some((link) => link.state === 'open') ? 'Blocked' : 'Held'} ${when}`); break;
			case 'question': lines.push(`Question raised ${when}`); break;
			case 'pr_opened': lines.push(`PR opened ${when}`); break;
		}
	}
	return lines;
}
