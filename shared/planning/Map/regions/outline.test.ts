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

/** The smoothed curve the renderer draws, sampled along each quadratic into a polygon. */
function drawn(outline: RegionOutline): Float64Array {
	const { curve } = outline;
	const out: number[] = [];
	for (let i = 2; i < curve.length; i += 4) {
		const [sx, sy, cx, cy, ex, ey] = [curve[i - 2]!, curve[i - 1]!, curve[i]!, curve[i + 1]!, curve[i + 2]!, curve[i + 3]!];
		for (const t of [0, 0.25, 0.5, 0.75]) {
			const u = 1 - t;
			out.push(u * u * sx + 2 * u * t * cx + t * t * ex, u * u * sy + 2 * u * t * cy + t * t * ey);
		}
	}
	return Float64Array.from(out);
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
 * the traced loops and again on the smoothed curves the renderer draws.
 */
function expectSolidAndApart(inputs: readonly RegionInput[], outlines: readonly RegionOutline[], { every = 1 } = {}): void {
	const byKey = new Map(outlines.map((outline) => [outline.key, outline]));
	const input = new Map(inputs.map((i) => [i.key, i]));
	const ancestors = (key: string): Set<string> => {
		const found = new Set<string>();
		for (let p = input.get(key)!.parentKey; p; p = input.get(p)!.parentKey) found.add(p);
		return found;
	};
	// One outline per region with members, and every member inside it: no member left on an island.
	expect(outlines.map((o) => o.key).sort()).toEqual(inputs.filter((i) => i.members.length).map((i) => i.key).sort());
	for (const i of inputs) {
		const outline = byKey.get(i.key)!;
		for (const m of i.members) expect(insideLoop(m.x, m.y, outline.loop), `${m.x},${m.y} in ${i.key}`).toBe(true);
	}
	for (const shape of [(o: RegionOutline): Float64Array => o.loop, drawn]) {
		for (const a of outlines) {
			const above = ancestors(a.key);
			const own = shape(a);
			for (const b of outlines) {
				if (a === b) continue;
				const theirs = shape(b);
				if (above.has(b.key)) {
					// Nested regions sit inside every region around them.
					for (const [x, y] of points(own, every)) expect(insideLoop(x, y, theirs), `${a.key} inside ${b.key}`).toBe(true);
				} else if (!ancestors(b.key).has(a.key)) {
					// Unrelated regions never overlap.
					if (!boxesMeet(own, theirs)) continue;
					for (const [x, y] of points(own, every)) expect(insideLoop(x, y, theirs), `${a.key} apart from ${b.key}`).toBe(false);
				}
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

	it('keeps a nested region off a piece of its parent that a neighbor cut away', () => {
		const inputs = [
			region('P', [[0, 0], [10, 8], [-8, 10], [300, 0]], { height: 2 }),
			region('C', [[300, 0]], { parentKey: 'P' }),
			region('B', Array.from({ length: 9 }, (_, i): [number, number] => [150 + 12 * (i % 3), -12 + 12 * Math.floor(i / 3)]), { height: 3 }),
		];
		const outlines = traceRegions(inputs, 5);
		const parent = outlines.find((o) => o.key === 'P')!;
		// The parent's island around (300, 0) was dropped, so its child has nowhere to draw.
		expect(insideLoop(300, 0, parent.loop)).toBe(false);
		const child = outlines.find((o) => o.key === 'C');
		if (child) for (const [x, y] of points(child.loop)) expect(insideLoop(x, y, parent.loop)).toBe(true);
		expect(child).toBeUndefined();
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

	it('stops widening at four levels of nesting, so a deep hierarchy stays nested and cheap', () => {
		const levels = 12;
		const inputs = Array.from({ length: levels }, (_, i) =>
			region(`R${i}`, [[0, 0], [30, 10]], { parentKey: i ? `R${i - 1}` : null, height: levels - i }),
		);
		const outlines = traceRegions(inputs, 5);
		expect(outlines).toHaveLength(levels);
		const width = (o: RegionOutline): number => o.bounds.maxX - o.bounds.minX;
		const outer = outlines.find((o) => o.key === 'R0')!;
		// The outermost is as wide as a lone region with four levels inside it, not eleven.
		const [four] = traceRegions([region('S', [[0, 0], [30, 10]], { height: 5 })], 5);
		expect(width(outer)).toBeCloseTo(width(four!), 0);
		expectSolidAndApart(inputs, outlines);
	});

	it('traces a nesting thousands deep without an ancestor set per region or a scan of every pair', () => {
		const levels = 2_000;
		const inputs = Array.from({ length: levels }, (_, i) =>
			region(`R${i}`, [[0, 0]], { parentKey: i ? `R${i - 1}` : null, height: levels - i }),
		);
		// Two unrelated neighbors beside the chain, so the rival sweep has work to do.
		inputs.push(region('N1', [[60, 0]]), region('N2', [[-60, 0]]));
		const outlines = traceRegions(inputs, 5);
		// Each level keeps a margin inside the one around it, so with one member between them all,
		// a dozen or so levels in there is no ground left to draw; what does draw still nests.
		expect(outlines.length).toBeGreaterThan(10);
		const outer = outlines.find((o) => o.key === 'R0')!;
		for (const o of outlines) if (o.key.startsWith('R') && o !== outer) for (const [x, y] of points(o.loop)) expect(insideLoop(x, y, outer.loop)).toBe(true);
		for (const [x, y] of points(outlines.find((o) => o.key === 'N1')!.loop)) expect(insideLoop(x, y, outer.loop)).toBe(false);
	});

	it('carries nested corridors up a deep chain over many members once each', () => {
		// Every level holds the same twenty members, so every level's tree is the same
		// tree; inherited corridors that weren't shared would pile up a level at a time.
		const members: Array<[number, number]> = Array.from({ length: 20 }, (_, i) => [i * 40, (i % 3) * 15]);
		const levels = 300;
		const inputs = Array.from({ length: levels }, (_, i) => region(`R${i}`, members, { parentKey: i ? `R${i - 1}` : null, height: levels - i }));
		const outlines = traceRegions(inputs, 5);
		const outer = outlines.find((o) => o.key === 'R0')!;
		for (const [x, y] of members) expect(insideLoop(x, y, outer.loop)).toBe(true);
		for (const o of outlines) if (o !== outer) for (const [x, y] of points(o.loop, 4)) expect(insideLoop(x, y, outer.loop)).toBe(true);
	});

	it('draws nothing for a region with no members', () => {
		expect(traceRegions([region('A', [])], 5)).toEqual([]);
	});

	it('spans a large, lopsided family with a tree as short as the exact one, give or take', () => {
		let seed = 7;
		const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
		const points = Array.from({ length: 400 }, () => ({ x: 600 * random(), y: 150 * random() }));
		points.push({ x: 3000, y: 900 }, { x: 3010, y: 905 });
		const tree = spanningTree(points);
		expect(tree).toHaveLength(points.length - 1);
		const root = points.map((_, i) => i);
		const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)));
		for (const [a, b] of tree) root[find(a)] = find(b);
		expect(new Set(points.map((_, i) => find(i))).size).toBe(1);

		// Exact Prim, for the length to beat.
		const inTree = new Set([0]);
		const best = points.map((p) => Math.hypot(p.x - points[0]!.x, p.y - points[0]!.y));
		let exact = 0;
		while (inTree.size < points.length) {
			let u = -1;
			for (let i = 0; i < points.length; i++) if (!inTree.has(i) && (u < 0 || best[i]! < best[u]!)) u = i;
			inTree.add(u);
			exact += best[u]!;
			for (let i = 0; i < points.length; i++) best[i] = Math.min(best[i]!, Math.hypot(points[i]!.x - points[u]!.x, points[i]!.y - points[u]!.y));
		}
		const length = tree.reduce((sum, [a, b]) => sum + Math.hypot(points[a]!.x - points[b]!.x, points[a]!.y - points[b]!.y), 0);
		expect(length).toBeLessThan(exact * 1.03);
	});

	it('spans every member with the shortest tree', () => {
		const tree = spanningTree([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 100, y: 0 }, { x: 11, y: 5 }]);
		expect(tree).toHaveLength(3);
		expect(tree.map(([a, b]) => [Math.min(a, b), Math.max(a, b)]).sort()).toEqual([[0, 1], [1, 3], [2, 3]].sort());
	});
});

describe('region outlines on laid-out boards', () => {
	const check = (layout: MapLayout, options?: { every?: number }): void => {
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

	it('stays solid and apart on a larger generated board, every family open', () => {
		const rows = syntheticBoard(300, 7);
		const collapse = Object.fromEntries(rows.filter((row) => row.type === 'epic').map((row) => [row.key, false]));
		check(layoutMap({ rows, now: Date.parse('2026-09-30T18:00:00Z'), collapse, aspect: 2 }), { every: 3 });
	});
});

describe('every member inside its own outline', () => {
	const now = Date.parse('2026-09-30T18:00:00Z');
	const outside = (layout: MapLayout): { outside: string[]; members: number } => {
		const inputs = regionInputs(layout);
		const outlines = new Map(traceRegions(inputs, gridStep(1)).map((o) => [o.key, o]));
		const found: string[] = [];
		let members = 0;
		for (const input of inputs) {
			for (const m of input.members) {
				members++;
				const outline = outlines.get(input.key);
				if (!outline || !insideLoop(m.x, m.y, outline.loop)) found.push(`${m.x.toFixed(1)},${m.y.toFixed(1)} outside ${input.key}`);
			}
		}
		return { outside: found, members };
	};
	it('after a local pass that changes a leaf of a nested family', () => {
		const board = realisticBoard();
		const before = layoutMap({ rows: board.rows, now, collapse: {}, aspect: 2.5 });
		const nested = board.rows.find((row) => row.key === before.regions.find((r) => r.depth === 1)!.key)!;
		const rows = board.rows.map((row) => ({ ...row }));
		const leaf = rows.find((row) => row.parentKey === nested.key && row.status === 'ready')!;
		leaf.status = 'in_progress';
		leaf.startedAt = new Date(now).toISOString();
		leaf.timeAnchor = leaf.startedAt;
		const positions = Object.fromEntries(before.nodes.map((n) => [n.key, { x: n.x, y: n.y }]));
		const after = layoutMap({ rows, now, collapse: {}, aspect: 2.5, previous: { frame: before.frame, positions, changed: [leaf.key] } });
		const { outside: lost } = outside(after);
		expect(lost, lost.join('; ')).toEqual([]);
	});

	const boards = [
		['the realistic board', realisticBoard().rows],
		['a generated 1,000-item board', syntheticBoard(1000, 7)],
	] as const;
	for (const [name, rows] of boards) {
		const open = Object.fromEntries(rows.filter((row) => row.type === 'epic').map((row) => [row.key, false]));
		for (const [mode, collapse] of [['as it opens', {}], ['with every family open', open]] as const) {
			it(`on ${name}, ${mode}`, () => {
				const { outside: lost, members } = outside(layoutMap({ rows, now, collapse, aspect: 2.5 }));
				expect(members).toBeGreaterThan(40);
				// A member a hair over a grid edge from its loop is the grid's rounding, not a stranger's ground.
				expect(lost.length, lost.join('; ')).toBeLessThanOrEqual(Math.floor(members / 200));
			}, 30_000);
		}
	}
});

describe('region inputs', () => {
	it('counts nesting heights without recursion, however deep the nesting runs', () => {
		const depth = 20_000;
		const regions = Array.from({ length: depth }, (_, i) => ({
			key: `R-${i}`,
			parentKey: i ? `R-${i - 1}` : null,
			depth: i,
			members: ['DOT'],
		}));
		const layout = { regions, nodes: [{ key: 'DOT', kind: 'item', x: 0, y: 0, r: 5.5, hub: false }] } as unknown as MapLayout;
		const inputs = regionInputs(layout);
		expect(inputs[0]!.height).toBe(depth);
		expect(inputs.at(-1)!.height).toBe(1);
		expect(inputs[0]!.members).toEqual([{ x: 0, y: 0, r: 5.5 }]);
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
