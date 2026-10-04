import { describe, expect, it } from 'vitest';
import { regionBands, type Band } from './bands';
import type { SimNode } from './forces';

const dot = (key: string, x: number, y: number, pinned = false): SimNode => ({
	key,
	kind: 'item',
	phase: 'next',
	r: 5.5,
	hub: false,
	tx: x,
	kx: 0,
	ty: 0,
	ky: 0,
	family: null,
	x,
	y,
	vx: 0,
	vy: 0,
	...(pinned ? { fx: x, fy: y } : {}),
});

describe('regionBands', () => {
	it('parts siblings that share time, moving each with everything nested in it', () => {
		const a = [dot('a1', 0, 0), dot('a2', 100, 0)];
		const nested = [dot('n1', 40, 5), dot('n2', 60, 5)];
		const b = [dot('b1', 20, 2), dot('b2', 80, 2)];
		const bands: Band[] = [
			{ hub: null, direct: a, parent: -1 },
			{ hub: null, direct: b, parent: -1 },
			{ hub: null, direct: nested, parent: 0 },
		];
		regionBands(bands)(1);
		const shiftA = a[0]!.vy;
		expect(Math.abs(shiftA)).toBeGreaterThan(1);
		for (const n of [...a, ...nested]) expect(n.vy).toBeCloseTo(shiftA);
		for (const n of b) expect(n.vy).toBeCloseTo(-shiftA);
	});

	it('leaves siblings apart in time where they are', () => {
		const a = [dot('a1', 0, 0), dot('a2', 50, 0)];
		const b = [dot('b1', 500, 0), dot('b2', 550, 0)];
		regionBands([
			{ hub: null, direct: a, parent: -1 },
			{ hub: null, direct: b, parent: -1 },
		])(1);
		for (const n of [...a, ...b]) expect(n.vy).toBe(0);
	});

	it('holds a band with any pinned dot, nested or direct', () => {
		const a = [dot('a1', 0, 0), dot('a2', 100, 0)];
		const nested = [dot('n1', 50, 0, true)];
		const b = [dot('b1', 50, 1)];
		regionBands([
			{ hub: null, direct: a, parent: -1 },
			{ hub: null, direct: b, parent: -1 },
			{ hub: null, direct: nested, parent: 0 },
		])(1);
		for (const n of [...a, ...nested]) expect(n.vy).toBe(0);
		expect(b[0]!.vy).toBeGreaterThan(0);
	});

	it('stays linear down a chain thousands deep with a dot of its own at every level', () => {
		// Each level is a region holding the next and one direct dot, beside a band of its
		// own, so every level has a sibling; gathering extents per level would be quadratic.
		const levels = 3_000;
		const bands: Band[] = [];
		for (let level = 0; level < levels; level++) {
			const region = bands.length;
			bands.push({ hub: dot(`h${level}`, 0, 0), direct: [], parent: level ? region - 2 : -1 });
			bands.push({ hub: null, direct: [dot(`d${level}`, level, level % 7)], parent: region });
		}
		bands.push({ hub: null, direct: [dot('loose', 10, 0)], parent: -1 });
		const force = regionBands(bands);
		for (let tick = 0; tick < 280; tick++) force(0.5);
		for (const band of bands) for (const n of band.direct) expect(Number.isFinite(n.vy)).toBe(true);
	});
});
