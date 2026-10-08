import type { MapItemRow } from '@specboard/core/map-read';
import { glyphStatus } from '@specboard/ui';

/**
 * What a refresh changed, by item key: the change notification the Map consumes from its
 * model. The transport behind it (a poll today, a push once SPE-203 lands) is the model's
 * business; the Map only ever sees these.
 */
export interface MapUpdate {
	/** Items the Map didn't have. */
	added: ReadonlySet<string>;
	/** Items gone from the project. */
	removed: ReadonlySet<string>;
	/** Status, sub-status, or the blocked flag changed: the dot restyles where it stands. */
	restyled: ReadonlySet<string>;
	/** Something the layout reads changed (an anchor, a link, the parent, an agent session): the local pass moves these, and their neighbors. */
	moved: ReadonlySet<string>;
	/** An agent wrote to these since the last read: one ring each. */
	wrote: ReadonlySet<string>;
}

export const NO_UPDATE: MapUpdate = { added: new Set(), removed: new Set(), restyled: new Set(), moved: new Set(), wrote: new Set() };

/** Any change at all; an idle poll has none. */
export const changesAnything = (changes: MapUpdate): boolean =>
	changes.added.size + changes.removed.size + changes.restyled.size + changes.moved.size + changes.wrote.size > 0;

/** The items to flash under reduced motion: everything that changed but a bare write, whose glow already shows it. */
export const changedKeys = (changes: MapUpdate): Set<string> => new Set([...changes.added, ...changes.restyled, ...changes.moved]);

const sameList = <T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): boolean =>
	a.length === b.length && a.every((x, i) => same(x, b[i]!));

/** Whether anything the layout reads differs: what places a dot, sizes it, or ties it to another. */
function movesLayout(before: MapItemRow, after: MapItemRow): boolean {
	return before.timeAnchor !== after.timeAnchor
		|| before.status !== after.status
		|| before.blocked !== after.blocked
		|| before.parentKey !== after.parentKey
		|| before.rank !== after.rank
		|| before.startedAt !== after.startedAt
		|| before.completedAt !== after.completedAt
		|| before.discoveredFromKey !== after.discoveredFromKey
		|| before.summarizedDescendants !== after.summarizedDescendants
		|| !sameList(before.blockers, after.blockers, (x, y) => x.blockerKey === y.blockerKey && x.state === y.state)
		|| !sameList(before.workers, after.workers, (x, y) => x.sessionKey === y.sessionKey && x.deviceName === y.deviceName && x.personName === y.personName);
}

/** An agent wrote since `before`: a session the item didn't have, or one whose last write moved. */
function wroteTo(before: MapItemRow, after: MapItemRow): boolean {
	const last = new Map(before.workers.map((episode) => [episode.sessionKey, episode.lastWriteAt]));
	return after.workers.some((episode) => {
		const previous = last.get(episode.sessionKey);
		return previous === undefined || Date.parse(episode.lastWriteAt) > Date.parse(previous);
	});
}

/**
 * What changed between the rows the Map shows and the rows it is about to show, both whole
 * projects. Reads that buffered between two applies are compared at once, so whatever
 * came and went in between, and rows a delta repeated unchanged (its cursor overlaps the
 * read before), are no change at all.
 */
export function diffRows(before: ReadonlyMap<string, MapItemRow>, after: ReadonlyMap<string, MapItemRow>): MapUpdate {
	const added = new Set<string>();
	const removed = new Set<string>();
	const restyled = new Set<string>();
	const moved = new Set<string>();
	const wrote = new Set<string>();
	for (const row of after.values()) {
		const old = before.get(row.key);
		if (!old) {
			added.add(row.key);
			continue;
		}
		if (old === row) continue;
		if (glyphStatus(old.status, old.blocked) !== glyphStatus(row.status, row.blocked) || old.subStatus !== row.subStatus) restyled.add(row.key);
		if (movesLayout(old, row)) moved.add(row.key);
		if (wroteTo(old, row)) wrote.add(row.key);
	}
	for (const key of before.keys()) if (!after.has(key)) removed.add(key);
	return { added, removed, restyled, moved, wrote };
}
