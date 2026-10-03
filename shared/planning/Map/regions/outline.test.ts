import { describe, expect, it } from 'vitest';
import { realisticBoard, syntheticBoard } from '../layout/board-fixture';
import { layoutMap } from '../layout/layout';
import type { MapLayout } from '../layout/types';
import { insideLoop, spanningTree, traceRegions, type RegionInput, type RegionOutline } from './outline';
import { gridStep, regionInputs } from './region-outlines';

const region = (key: string, members: Array<[number, number]>, extra: Partial<RegionInput> = {}): RegionInput => ({
	key,
	parentKey: null,
	height: 1,
	members: members.map(([x, y]) => ({ x, y, r: 5.5 })),
	...extra,
});

const points = (loop: Float64Array, every = 1): Array<[number, number]> =>
	Array.from({ length: Math.ceil(loop.length / 2 / every) }, (_, i) => [loop[2 * i * every]!, loop[2 * i * every + 1]!]);

/** Whether two traced loops' boxes meet; loops whose boxes don't can't overlap. */
function boxesMeet(a: Float64Array, b: Float64Array): boolean {
	const box = (loop: Float64Array): number[] => {
		const xs = loop.filter((_, i) => i % 2 === 0);
		const ys = loop.filter((_, i) => i % 2 === 1);
		return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
	};
	const [ax0, ax1, ay0, ay1] = box(a);
	const [bx0, bx1, by0, by1] = box(b);
	return ax0! <= bx1! && ax1! >= bx0! && ay0! <= by1! && ay1! >= by0!;
}

/** The loop's width across a vertical line at x: the span between its crossings. */
function heightAt(outline: RegionOutline, x: number): number {
	let low = Infinity;
	let high = -Infinity;
	for (let y = outline.bounds.minY - 1; y <= outline.bounds.maxY + 1; y += 0.5) {
		if (!insideLoop(x, y, outline.loop)) continue;
		low = Math.min(low, y);
		high = Math.max(high, y);
	}
	return Number.isFinite(low) ? high - low : 0;
}

/**
 * Every structural promise the spec makes about outlines (spec, Regions), checked on
 * traced loops. Members land inside their own outline only where the layout kept
 * families apart; where it lets two families interleave, the neighbor wins that ground.
 */
function expectSolidAndApart(inputs: readonly RegionInput[], outlines: readonly RegionOutline[], { membersInside = true, every = 1 } = {}): void {
	const byKey = new Map(outlines.map((outline) => [outline.key, outline]));
	const input = new Map(inputs.map((i) => [i.key, i]));
	const ancestors = (key: string): Set<string> => {
		const found = new Set<string>();
		for (let p = input.get(key)!.parentKey; p; p = input.get(p)!.parentKey) found.add(p);
		return found;
	};
	// One outline per region with members, and every member inside it: no member left on an island.
	expect(outlines.map((o) => o.key).sort()).toEqual(inputs.filter((i) => i.members.length).map((i) => i.key).sort());
	for (const i of membersInside ? inputs : []) {
		const outline = byKey.get(i.key)!;
		for (const m of i.members) expect(insideLoop(m.x, m.y, outline.loop), `${m.x},${m.y} in ${i.key}`).toBe(true);
	}
	for (const a of outlines) {
		const above = ancestors(a.key);
		for (const b of outlines) {
			if (a === b) continue;
			if (above.has(b.key)) {
				// Nested regions sit inside every region around them.
				for (const [x, y] of points(a.loop, every)) expect(insideLoop(x, y, b.loop), `${a.key} inside ${b.key}`).toBe(true);
			} else if (!ancestors(b.key).has(a.key)) {
				// Unrelated regions never overlap.
				if (!boxesMeet(a.loop, b.loop)) continue;
				for (const [x, y] of points(a.loop, every)) expect(insideLoop(x, y, b.loop), `${a.key} apart from ${b.key}`).toBe(false);
			}
		}
	}
	// Outer regions come first, so nested ones draw over them.
	const depths = outlines.map((o) => o.depth);
	expect(depths).toEqual([...depths].sort((x, y) => x - y));
}

describe('region outlines', () => {
	it('sits loose around a lone member, not shrink-wrapped', () => {
		const [outline] = traceRegions([region('A', [[0, 0]])], 5);
		const radii = points(outline!.loop).map(([x, y]) => Math.hypot(x, y));
		// (1 - d / R)^2 = 0.22 with R = 5.5 + 32 crosses at about 20.
		expect(Math.min(...radii)).toBeGreaterThan(17);
		expect(Math.max(...radii)).toBeLessThan(23);
	});

	it('keeps a long-running family in one piece: bulbs on a thin neck', () => {
		const left: Array<[number, number]> = [[0, 0], [12, 10], [10, -12], [-12, 8]];
		const right: Array<[number, number]> = [[400, 0], [412, 10], [410, -12], [388, -8]];
		const outlines = traceRegions([region('A', [...left, ...right])], 5);
		expect(outlines).toHaveLength(1);
		const [outline] = outlines;
		for (const [x, y] of [...left, ...right]) expect(insideLoop(x, y, outline!.loop)).toBe(true);
		expect(heightAt(outline!, 200)).toBeGreaterThan(0);
		expect(heightAt(outline!, 200)).toBeLessThan(heightAt(outline!, 0) / 2);
	});

	it('fills a ring of members in: no holes', () => {
		const ring: Array<[number, number]> = Array.from({ length: 16 }, (_, i) => [140 * Math.cos((i * Math.PI) / 8), 140 * Math.sin((i * Math.PI) / 8)]);
		const [outline] = traceRegions([region('A', ring)], 5);
		expect(insideLoop(0, 0, outline!.loop)).toBe(true);
	});

	it('splits ground between unrelated neighbors so they meet without overlapping', () => {
		const inputs = [region('A', [[0, 0], [20, 10]]), region('B', [[50, 0], [70, -10]])];
		const outlines = traceRegions(inputs, 5);
		expectSolidAndApart(inputs, outlines);
		// Their fields overlap, so they meet: the gap between them is a hairline, not a moat.
		const a = points(outlines.find((o) => o.key === 'A')!.loop);
		const b = points(outlines.find((o) => o.key === 'B')!.loop);
		const gap = Math.min(...a.flatMap(([ax, ay]) => b.map(([bx, by]) => Math.hypot(ax - bx, ay - by))));
		expect(gap).toBeGreaterThan(0);
		expect(gap).toBeLessThan(4);
	});

	it('weighs each neighbor against the region\'s own field, so a second neighbor on the same ground takes nothing more', () => {
		const a = region('A', [[0, 0], [20, 10]]);
		const b: Array<[number, number]> = [[50, 0], [70, -10]];
		const alone = traceRegions([a, region('B', b)], 5).find((o) => o.key === 'A')!;
		const twice = traceRegions([a, region('B', b), region('C', b)], 5).find((o) => o.key === 'A')!;
		expect(Array.from(twice.loop)).toEqual(Array.from(alone.loop));
	});

	it('keeps one shape when a neighbor cuts across a neck, the side holding most members', () => {
		const inputs = [
			region('A', [[0, 0], [10, 8], [-8, 10], [300, 0]]),
			region('B', Array.from({ length: 9 }, (_, i): [number, number] => [150 + 12 * (i % 3), -12 + 12 * Math.floor(i / 3)]), { height: 3 }),
		];
		const outlines = traceRegions(inputs, 5);
		const a = outlines.find((o) => o.key === 'A')!;
		expect(insideLoop(0, 0, a.loop)).toBe(true);
		for (const [x, y] of points(a.loop)) expect(insideLoop(x, y, outlines.find((o) => o.key === 'B')!.loop)).toBe(false);
	});

	it('nests a region inside its parent, with more room for the parent', () => {
		const inputs = [
			region('P', [[0, 0], [20, 20], [60, 0], [70, 15]], { height: 2 }),
			region('C', [[60, 0], [70, 15]], { parentKey: 'P' }),
		];
		const outlines = traceRegions(inputs, 5);
		expect(outlines.map((o) => o.key)).toEqual(['P', 'C']);
		expectSolidAndApart(inputs, outlines);
	});

	it('draws nothing for a region with no members', () => {
		expect(traceRegions([region('A', [])], 5)).toEqual([]);
	});

	it('spans every member with the shortest tree', () => {
		const tree = spanningTree([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 100, y: 0 }, { x: 11, y: 5 }]);
		expect(tree).toHaveLength(3);
		expect(tree.map(([a, b]) => [Math.min(a, b), Math.max(a, b)]).sort()).toEqual([[0, 1], [1, 3], [2, 3]].sort());
	});
});

describe('region outlines on laid-out boards', () => {
	const check = (layout: MapLayout, options?: { membersInside?: boolean; every?: number }): void => {
		const inputs = regionInputs(layout);
		expect(inputs.length).toBeGreaterThan(0);
		for (const step of [gridStep(1), gridStep(4)]) expectSolidAndApart(inputs, traceRegions(inputs, step), options);
	};

	it('holds on the realistic board, its nested epic and chains included', () => {
		const { rows } = realisticBoard();
		const layout = layoutMap({ rows, now: Date.parse('2026-09-30T18:00:00Z'), collapse: {}, aspect: 2 });
		expect(layout.regions.some((r) => r.parentKey)).toBe(true);
		check(layout);
	});

	it('holds with the finished epic opened up beside the open ones', () => {
		const board = realisticBoard();
		const layout = layoutMap({ rows: board.rows, now: Date.parse('2026-09-30T18:00:00Z'), collapse: { [board.finished.key]: false }, aspect: 2 });
		check(layout);
	});

	it('stays solid and apart on a larger generated board whose families interleave, every family open', () => {
		const rows = syntheticBoard(300, 7);
		const collapse = Object.fromEntries(rows.filter((row) => row.type === 'epic').map((row) => [row.key, false]));
		check(layoutMap({ rows, now: Date.parse('2026-09-30T18:00:00Z'), collapse, aspect: 2 }), { membersInside: false, every: 3 });
	});
});

describe('grid step', () => {
	it('resolves outlines to about 5 px on screen in buckets of powers of two, never coarser than a neck', () => {
		expect(gridStep(1)).toBe(5);
		expect(gridStep(1.3)).toBe(5);
		expect(gridStep(0.5)).toBe(5);
		expect(gridStep(0.05)).toBe(5);
		expect(gridStep(2)).toBe(2.5);
		expect(gridStep(8)).toBe(2.5);
	});
});
