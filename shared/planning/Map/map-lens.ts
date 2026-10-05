import type { MapItemRow, MapItemType } from '@specboard/core/map-read';
import type { MapLayout, MapPhase } from './layout/types';
import type { MapFacts } from './map-facts';
import type { Relation } from './relations';

/**
 * Search and filters on the Map (spec, Navigation and interaction): they dim what doesn't
 * match and never move anything, so nothing here touches the layout. A lens is the set of
 * items that pass every active test, and the nodes and regions that draw them.
 */

export interface MapFilters {
	type: MapItemType | null;
	/** Empty for no phase filter; otherwise an item in any of these phases passes. */
	phases: ReadonlySet<MapPhase>;
	needsPerson: boolean;
	live: boolean;
}

export const NO_FILTERS: MapFilters = { type: null, phases: new Set(), needsPerson: false, live: false };

export function filtersActive(filters: MapFilters): boolean {
	return filters.type !== null || filters.phases.size > 0 || filters.needsPerson || filters.live;
}

const PHASE_NAMES: Record<MapPhase, string> = { done: 'done', in_flight: 'in flight', next: 'next', later: 'later' };

/** The filters that are on, in words, for the stepping bar's title when there is no search. */
export function describeFilters(filters: MapFilters): string[] {
	const parts: string[] = [];
	if (filters.type) parts.push(`${filters.type}s`);
	for (const phase of ['done', 'in_flight', 'next', 'later'] as const) if (filters.phases.has(phase)) parts.push(PHASE_NAMES[phase]);
	if (filters.needsPerson) parts.push('needs a person');
	if (filters.live) parts.push('live sessions');
	return parts;
}

/** What is lit, in the terms the drawing uses. */
export interface Highlight {
	/** The dots that draw a match, a folded family's dot included. */
	dots: ReadonlySet<string>;
	/** Regions drawn at full strength: those that match and those with a match inside. */
	regions: ReadonlySet<string>;
	/** Regions whose own parent matches, which get a lit outline. */
	outlined: ReadonlySet<string>;
	/**
	 * Set by the changes view, which gives its labels to the most recent changes: the nodes
	 * (dots, or regions whose parent changed) that are named first at rest, and the
	 * families that are then left without labels. Search and filters leave it unset.
	 */
	recent?: ReadonlySet<string>;
}

export interface Lens {
	/** A search or a filter is on, whether or not anything matched. */
	active: boolean;
	/** Item keys that pass, in reading order: left to right across the Map. */
	matches: string[];
	/** Null when the lens is off or nothing matched, so nothing dims. */
	highlight: Highlight | null;
}

export const NO_LENS: Lens = { active: false, matches: [], highlight: null };

export interface LensInput {
	layout: MapLayout;
	rows: ReadonlyMap<string, MapItemRow>;
	facts: Pick<MapFacts, 'needs' | 'liveItems'>;
	filters: MapFilters;
	/** The keys the board's search returned for the settled text, or null when there is no search. */
	search: ReadonlySet<string> | null;
}

export function lensOf({ layout, rows, facts, filters, search }: LensInput): Lens {
	const active = search !== null || filtersActive(filters);
	if (!active) return NO_LENS;
	const passing: string[] = [];
	for (const row of rows.values()) {
		if (search && !search.has(row.key)) continue;
		if (filters.type && row.type !== filters.type) continue;
		if (filters.phases.size > 0 && !filters.phases.has(layout.phases[row.key]!)) continue;
		if (filters.needsPerson && !facts.needs.has(row.key)) continue;
		if (filters.live && !facts.liveItems.has(row.key)) continue;
		// An item the Map doesn't draw (it was folded away past the read cap) has nowhere to light.
		if (layout.representative[row.key]) passing.push(row.key);
	}
	if (passing.length === 0) return { active, matches: [], highlight: null };
	return { active, matches: inReadingOrder(passing, layout), highlight: highlightOf(passing, layout) };
}

/** Left to right across the Map, then top to bottom; the key breaks a tie, so a family folded into one dot steps in key order. */
export function inReadingOrder(keys: readonly string[], layout: MapLayout): string[] {
	const at = new Map(layout.nodes.filter((node) => node.kind === 'item').map((node) => [node.key, node]));
	const place = (key: string): { x: number; y: number } => at.get(layout.representative[key]!) ?? { x: 0, y: 0 };
	return [...keys].sort((a, b) => {
		const pa = place(a);
		const pb = place(b);
		return pa.x - pb.x || pa.y - pb.y || (a < b ? -1 : a > b ? 1 : 0);
	});
}

export function highlightOf(matches: readonly string[], layout: MapLayout, recent?: readonly string[]): Highlight {
	const regionByKey = new Map(layout.regions.map((region) => [region.key, region]));
	const dots = new Set<string>();
	const outlined = new Set<string>();
	for (const key of matches) {
		const node = layout.representative[key];
		if (!node) continue;
		if (regionByKey.has(node)) outlined.add(node);
		else dots.add(node);
	}
	const regions = new Set<string>();
	const light = (key: string | null): void => {
		for (let at = key === null ? undefined : regionByKey.get(key); at && !regions.has(at.key); at = at.parentKey === null ? undefined : regionByKey.get(at.parentKey)) {
			regions.add(at.key);
		}
	};
	for (const region of layout.regions) {
		if (outlined.has(region.key) || region.members.some((member) => dots.has(member))) light(region.key);
	}
	const recentNodes = recent && new Set(recent.flatMap((key) => layout.representative[key] ?? []));
	return recentNodes ? { dots, regions, outlined, recent: recentNodes } : { dots, regions, outlined };
}

const NO_LINKS: ReadonlySet<string> = new Set();

/**
 * What the focus fade lights when something is hovered, focused, or selected and a lens is on:
 * both. Nothing the lens lit goes dim because the pointer moved onto something else. With no
 * hover the lens is the whole relation; it has no item of its own, so nothing grows or darkens.
 */
export function litRelation(relation: Relation | null, highlight: Highlight | null): Relation | null {
	if (!highlight) return relation;
	if (!relation) return { key: '', region: false, dots: highlight.dots, regions: highlight.regions, outline: null, links: NO_LINKS };
	return { ...relation, dots: new Set([...relation.dots, ...highlight.dots]), regions: new Set([...relation.regions, ...highlight.regions]) };
}
