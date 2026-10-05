import type { MapItemRow } from '@specboard/core/map-read';
import type { MapLayout, MapPhase } from './layout/types';
import { liveSessions } from './live-sessions';
import { needsPerson, type NeedsPersonReasons } from './needs-person';

/** What the summary strip counts (spec, Summary strip). */
export interface MapSummary {
	/** Every item is in exactly one phase; finished work folded past the read cap counts as done. */
	phases: Record<MapPhase, number>;
	/** Items whose glyph reads Blocked: a hold, or an open blocker row, under any unfinished status. */
	blocked: number;
	needsPerson: number;
	/** Distinct agent sessions that wrote in the last 15 minutes. */
	liveSessions: number;
}

/** Facts about the Map's items that the strip counts and the filters test, computed once per layout. */
export interface MapFacts {
	needs: NeedsPersonReasons;
	/** Items with a live session on them. */
	liveItems: ReadonlySet<string>;
	summary: MapSummary;
}

export function mapFacts(layout: MapLayout, rows: ReadonlyMap<string, MapItemRow>, now: number): MapFacts {
	const needs = needsPerson(rows.values(), layout, now);
	const live = liveSessions(rows.values(), now);
	const phases: Record<MapPhase, number> = { done: 0, in_flight: 0, next: 0, later: 0 };
	let blocked = 0;
	for (const row of rows.values()) {
		phases[layout.phases[row.key]!]++;
		phases.done += row.summarizedDescendants ?? 0;
		if (row.blocked && row.status !== 'done') blocked++;
	}
	return { needs, liveItems: live.items, summary: { phases, blocked, needsPerson: needs.size, liveSessions: live.sessions.size } };
}
