/**
 * What changed on a project since a person last looked at its Map
 * (docs/specs/ai-development-overview.md, Since your last visit). The API computes these
 * from the item rows and the transition log, the planning client steps through them, so
 * the shape lives here where both can import it. Times are epoch milliseconds, which is
 * also how they cross the wire.
 */

import { formatItemKey, itemNumberInProject } from './identifiers.ts';

/**
 * Kinds of change, in the order the summary strip names them. An item can carry several
 * (finished and a PR opened, say); each is dated by its own event.
 */
export const MAP_CHANGE_KINDS = ['finished', 'worked_on', 'filed', 'blocked', 'question', 'pr_opened'] as const;

export type MapChangeKind = (typeof MAP_CHANGE_KINDS)[number];

export interface MapChange {
	key: string;
	kind: MapChangeKind;
	/** When it happened, epoch ms. */
	at: number;
}

export interface MapChanges {
	/** When this person last looked, epoch ms; null on a first visit, which has no changes to show. */
	baseline: number | null;
	/**
	 * The moment this read is good up to, epoch ms: stamped by the server before it read
	 * anything, so a change that lands while the read runs is never skipped. The client
	 * sends it back to move the baseline, never its own clock.
	 */
	readAt: number;
	/** Oldest first. */
	changes: MapChange[];
}

/** The changes in columns, with item keys as their numbers under `projectKey`, as the Map read does. */
export interface MapChangesWire {
	projectKey: string;
	baseline: number | null;
	readAt: number;
	number: number[];
	kind: MapChangeKind[];
	at: number[];
}

export function encodeMapChanges(read: MapChanges, projectKey: string): MapChangesWire {
	const numberOf = (key: string): number => {
		const number = itemNumberInProject(key, projectKey);
		if (number === null || formatItemKey(projectKey, number) !== key) throw new Error(`${key} is not an item key in ${projectKey}`);
		return number;
	};
	return {
		projectKey,
		baseline: read.baseline,
		readAt: read.readAt,
		number: read.changes.map((change) => numberOf(change.key)),
		kind: read.changes.map((change) => change.kind),
		at: read.changes.map((change) => change.at),
	};
}

export function decodeMapChanges(wire: MapChangesWire): MapChanges {
	return {
		baseline: wire.baseline,
		readAt: wire.readAt,
		changes: wire.number.map((number, i) => ({ key: `${wire.projectKey}-${number}`, kind: wire.kind[i]!, at: wire.at[i]! })),
	};
}
