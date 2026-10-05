import type { MapItemRow } from '@specboard/core/map-read';
import { describe, expect, it } from 'vitest';
import { insideLoop, traceRegions } from '../regions/outline';
import { regionInputs } from '../regions/region-outlines';
import { NOW, syntheticBoard } from './board-fixture';
import { NOW_MARGIN } from './constants';
import { layoutMap } from './layout';
import { boardA, boardB, type RealBoard } from './real-boards.fixture';
import type { MapLayout, MapNode } from './types';

/**
 * The layout on the structure of two real boards (anonymized in the fixture): one of about
 * 200 items, one of 272 with a 96-child finished epic and 145 discovered-from links. Their
 * done items carry no completion stamp, so they anchor on their latest event, as boards
 * from before the stamps do. The canvas's aspect varies, since the fit depends on it.
 */

const ASPECTS = [1.3, 1.9, 2.5, 3];

const nodesOf = (layout: MapLayout): Map<string, MapNode> => new Map(layout.nodes.map((n) => [n.key, n]));

/** A done item closes when its newest descendant's latest event happened, which is how the layout dates a folded family. */
function closedAt(rows: readonly MapItemRow[]): (row: MapItemRow) => number {
	const children = new Map<string, MapItemRow[]>();
	for (const row of rows) if (row.parentKey) children.set(row.parentKey, [...(children.get(row.parentKey) ?? []), row]);
	const memo = new Map<string, number>();
	const newest = (row: MapItemRow): number => {
		let value = memo.get(row.key);
		if (value === undefined) {
			value = Math.max(Date.parse(row.timeAnchor), ...(children.get(row.key) ?? []).map(newest));
			memo.set(row.key, value);
		}
		return value;
	};
	return newest;
}

function expectDoneInOrder(layout: MapLayout, rows: readonly MapItemRow[]): void {
	const node = nodesOf(layout);
	const closed = closedAt(rows);
	const done = rows.filter((row) => row.status === 'done' && node.get(row.key) && !node.get(row.key)!.hub).sort((a, b) => closed(a) - closed(b));
	for (let i = 1; i < done.length; i++) {
		if (closed(done[i]!) === closed(done[i - 1]!)) continue;
		expect(node.get(done[i]!.key)!.x, `${done[i]!.key} after ${done[i - 1]!.key}`).toBeGreaterThanOrEqual(node.get(done[i - 1]!.key)!.x);
	}
}

/** Dots that are drawn inside a region without being its members, by the outline the renderer traces. */
function strangersInRegions(layout: MapLayout): string[] {
	const outlines = traceRegions(regionInputs(layout), 5);
	const strangers: string[] = [];
	for (const region of layout.regions) {
		const outline = outlines.find((o) => o.key === region.key);
		if (!outline) continue;
		const members = new Set(region.members);
		for (const dot of layout.nodes) {
			if (dot.kind !== 'item' || dot.hub || members.has(dot.key)) continue;
			if (insideLoop(dot.x, dot.y, outline.loop)) strangers.push(`${dot.key} in ${region.key}`);
		}
	}
	return strangers;
}

function expectNoOverlaps(layout: MapLayout): void {
	const dots = layout.nodes.filter((n) => !n.hub);
	for (let i = 0; i < dots.length; i++) {
		for (let j = i + 1; j < dots.length; j++) {
			const a = dots[i]!;
			const b = dots[j]!;
			expect(Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r, `${a.key} and ${b.key}`).toBeGreaterThan(0);
		}
	}
}

const boards: Array<[string, () => RealBoard]> = [
	['the 200-item board', boardA],
	['the 272-item board', boardB],
];

for (const [name, load] of boards) {
	describe(`layoutMap on ${name}`, () => {
		const { now, rows } = load();

		for (const aspect of ASPECTS) {
			describe(`at an aspect of ${aspect}`, () => {
				const layout = layoutMap({ rows, now, collapse: {}, aspect });

				it('keeps finished work in the order it closed, and nothing overlapping', () => {
					expectDoneInOrder(layout, rows);
					expectNoOverlaps(layout);
				});

				it('keeps every loose dot out of every region, the ones tied to a family by discovered-from included', () => {
					expect(strangersInRegions(layout)).toEqual([]);
				});

				it('keeps every member inside its own region', () => {
					const outlines = new Map(traceRegions(regionInputs(layout), 5).map((o) => [o.key, o]));
					for (const input of regionInputs(layout)) {
						for (const m of input.members) expect(insideLoop(m.x, m.y, outlines.get(input.key)!.loop), `${m.x},${m.y} in ${input.key}`).toBe(true);
					}
				});

				it('ends the Map just past the last dot when no agent is working, rather than reserving a strip for one', () => {
					expect(layout.computers).toEqual([]);
					const rightmost = Math.max(...layout.nodes.map((n) => n.x + n.r));
					const { maxX } = layout.frame.bounds;
					expect(maxX).toBeGreaterThanOrEqual(rightmost);
					expect(maxX).toBeLessThanOrEqual(Math.max(rightmost, NOW_MARGIN * layout.frame.scale.unit) + 1e-6);
				});
			});
		}
	});
}

describe('layoutMap on a generated 1,000-item board', () => {
	// Open epics whose children spread over months: the loose items between them used to land on their ground.
	it('keeps every loose dot out of every region', () => {
		const layout = layoutMap({ rows: syntheticBoard(1000, 7), now: NOW, collapse: {}, aspect: 2.5 });
		expect(strangersInRegions(layout)).toEqual([]);
	}, 120_000);
});

