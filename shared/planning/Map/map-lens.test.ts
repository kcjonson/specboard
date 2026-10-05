import { describe, expect, it } from 'vitest';
import type { MapItemRow } from '@specboard/core/map-read';
import { BoardBuilder } from './layout/board-fixture';
import { layoutMap } from './layout/layout';
import type { MapLayout } from './layout/types';
import { mapFacts } from './map-facts';
import { NO_FILTERS, NO_LENS, describeFilters, filtersActive, highlightOf, lensOf, litRelation, type MapFilters } from './map-lens';
import { RelationIndex } from './relations';

interface Scene {
	rows: ReadonlyMap<string, MapItemRow>;
	layout: MapLayout;
	epic: MapItemRow;
	nestedEpic: MapItemRow;
	inNested: MapItemRow;
	child: MapItemRow;
	asked: MapItemRow;
	bug: MapItemRow;
	live: MapItemRow;
	next: MapItemRow;
	folded: MapItemRow;
	inFolded: MapItemRow[];
	loose: MapItemRow;
}

function scene(): Scene {
	const b = new BoardBuilder();
	const epic = b.add({ type: 'epic', status: 'in_progress' });
	const child = b.add({ parentKey: epic.key, status: 'ready' });
	const asked = b.add({ parentKey: epic.key, status: 'in_progress', subStatus: 'needs_input' });
	const nestedEpic = b.add({ parentKey: epic.key, type: 'epic', status: 'in_progress' });
	const inNested = b.add({ parentKey: nestedEpic.key, status: 'ready' });
	b.add({ parentKey: nestedEpic.key, status: 'done' });
	const folded = b.add({ type: 'epic', status: 'done' });
	const inFolded = [b.add({ parentKey: folded.key, status: 'done' }), b.add({ parentKey: folded.key, status: 'done' })];
	const bug = b.add({ type: 'bug', status: 'ready' });
	const live = b.add({ status: 'in_progress' });
	b.work(live, 'session-a', 'laptop', 3);
	const next = b.add({ status: 'ready' });
	const loose = b.add({ status: 'done' });
	const rows = new Map(b.rows.map((row) => [row.key, row]));
	const layout = layoutMap({ rows: b.rows, now: b.now, collapse: {}, aspect: 2 });
	return { rows, layout, epic, nestedEpic, inNested, child, asked, bug, live, next, folded, inFolded, loose };
}

const lens = (s: Scene, over: { filters?: Partial<MapFilters>; search?: string[] | null } = {}): ReturnType<typeof lensOf> =>
	lensOf({
		layout: s.layout,
		rows: s.rows,
		facts: mapFacts(s.layout, s.rows, Date.parse('2026-09-30T18:00:00Z')),
		filters: { ...NO_FILTERS, ...over.filters },
		search: over.search === undefined || over.search === null ? null : new Set(over.search),
	});

describe('the lens', () => {
	it('is off with no search and no filter, and lights nothing', () => {
		expect(lens(scene())).toBe(NO_LENS);
		expect(filtersActive(NO_FILTERS)).toBe(false);
	});

	it('maps the keys a search returns onto the Map, dropping any the Map does not draw', () => {
		const s = scene();
		const result = lens(s, { search: [s.child.key, s.bug.key, 'MAP-999'] });
		expect(result.active).toBe(true);
		expect([...result.matches].sort()).toEqual([s.child.key, s.bug.key].sort());
		expect(result.highlight!.dots).toEqual(new Set([s.child.key, s.bug.key]));
	});

	it('steps in reading order, left to right across the Map', () => {
		const s = scene();
		const result = lens(s, { search: s.layout.nodes.filter((n) => n.kind === 'item' && !n.hub).map((n) => n.key) });
		const x = (key: string): number => s.layout.nodes.find((node) => node.key === s.layout.representative[key])!.x;
		const xs = result.matches.map(x);
		expect(xs).toEqual([...xs].sort((a, b) => a - b));
	});

	it('lights a folded family\'s dot for a match inside it, and counts each item that matched', () => {
		const s = scene();
		expect(s.layout.collapsed).toContain(s.folded.key);
		const result = lens(s, { search: s.inFolded.map((row) => row.key) });
		expect(result.matches).toHaveLength(2);
		expect(result.highlight!.dots).toEqual(new Set([s.folded.key]));
	});

	it('lights the regions around a matched dot, the ones it sits in and the ones around those', () => {
		const s = scene();
		const { dots, regions, outlined } = lens(s, { search: [s.inNested.key] }).highlight!;
		expect(dots).toEqual(new Set([s.inNested.key]));
		expect(regions).toEqual(new Set([s.nestedEpic.key, s.epic.key]));
		expect(outlined.size).toBe(0);
	});

	it('gives a region whose own parent matches a lit outline, and leaves its children dim', () => {
		const s = scene();
		const { dots, regions, outlined } = lens(s, { search: [s.epic.key] }).highlight!;
		expect(outlined).toEqual(new Set([s.epic.key]));
		expect(regions).toEqual(new Set([s.epic.key]));
		expect(dots.size).toBe(0);
	});

	it('filters by type, by phase (any of those chosen), by needs a person, and by live sessions', () => {
		const s = scene();
		expect(lens(s, { filters: { type: 'bug' } }).matches).toEqual([s.bug.key]);
		const done = [...s.rows.values()].filter((row) => row.status === 'done').map((row) => row.key);
		expect(done.length).toBeGreaterThan(4);
		expect(new Set(lens(s, { filters: { phases: new Set(['done']) } }).matches)).toEqual(new Set(done));
		const phases = lens(s, { filters: { phases: new Set(['next', 'in_flight']) } }).matches;
		expect(phases).toContain(s.child.key);
		expect(phases).toContain(s.live.key);
		expect(phases).not.toContain(s.loose.key);
		expect(lens(s, { filters: { needsPerson: true } }).matches).toEqual([s.asked.key]);
		expect(lens(s, { filters: { live: true } }).matches).toEqual([s.live.key]);
	});

	it('needs every active test to pass: a search and a filter together narrow, they do not widen', () => {
		const s = scene();
		expect(lens(s, { search: [s.asked.key, s.bug.key], filters: { needsPerson: true } }).matches).toEqual([s.asked.key]);
		expect(lens(s, { search: [s.loose.key], filters: { needsPerson: true } }).matches).toEqual([]);
	});

	it('is active with nothing matched when the search or filter finds nothing, and dims nothing', () => {
		const s = scene();
		const none = lens(s, { search: [] });
		expect(none).toMatchObject({ active: true, matches: [], highlight: null });
		expect(lens(s, { filters: { type: 'bug', needsPerson: true } })).toMatchObject({ active: true, matches: [], highlight: null });
	});

	it('does not touch the layout: the same layout object comes back out and nothing in it moved', () => {
		const s = scene();
		const before = JSON.stringify(s.layout.nodes);
		lens(s, { search: [s.child.key], filters: { phases: new Set(['next']) } });
		expect(JSON.stringify(s.layout.nodes)).toBe(before);
	});
});

describe('describing the filters', () => {
	it('names the ones that are on, in the strip\'s order', () => {
		expect(describeFilters({ type: 'bug', phases: new Set(['next', 'done']), needsPerson: true, live: true })).toEqual(['bugs', 'done', 'next', 'needs a person', 'live sessions']);
		expect(describeFilters(NO_FILTERS)).toEqual([]);
	});
});

describe('what a lens and a hover light together', () => {
	it('is the relation alone when the lens is off, and the lens alone when nothing is hovered', () => {
		const s = scene();
		const index = new RelationIndex(s.layout, s.rows);
		const relation = index.relation(s.child.key)!;
		const highlight = highlightOf([s.bug.key], s.layout);
		expect(litRelation(relation, null)).toBe(relation);
		expect(litRelation(null, null)).toBeNull();
		const only = litRelation(null, highlight)!;
		expect(only.dots).toBe(highlight.dots);
		expect(only).toMatchObject({ key: '', region: false, outline: null });
		expect(only.links.size).toBe(0);
	});

	it('lights both: nothing the lens lit goes dim because the pointer moved onto something else', () => {
		const s = scene();
		const index = new RelationIndex(s.layout, s.rows);
		const relation = index.relation(s.child.key)!;
		const both = litRelation(relation, highlightOf([s.bug.key], s.layout))!;
		expect(both.key).toBe(relation.key);
		expect(both.dots.has(s.bug.key)).toBe(true);
		for (const dot of relation.dots) expect(both.dots.has(dot)).toBe(true);
		expect(both.regions.has(s.epic.key)).toBe(true);
	});
});
