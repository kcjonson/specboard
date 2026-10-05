import { describe, expect, it } from 'vitest';
import { cardBox } from './cards/card-culling';
import type { CollapseControl } from './collapse-controls';
import type { DrawDot, DrawRegion } from './draw-list';
import { COARSE_MIN_RADIUS, FINE_MIN_RADIUS, HitIndex, contains, type HitInput } from './hit-index';
import type { RegionLabel } from './region-labels';
import type { RegionOutline } from './regions/outline';

const transform = { k: 1, x: 0, y: 0 };

const dot = (key: string, x: number, y: number, r = 5.5): DrawDot => ({
	key,
	x,
	y,
	r,
	title: key,
	status: 'ready',
	flight: null,
	weight: 1,
	reason: null,
	upNext: null,
	cue: null,
	pr: false,
	folded: null,
});

const square = (x0: number, y0: number, x1: number, y1: number): Float64Array => new Float64Array([x0, y0, x1, y0, x1, y1, x0, y1]);

const outline = (key: string, loop: Float64Array, height: number, depth: number): RegionOutline => {
	const xs = Array.from(loop).filter((_, i) => i % 2 === 0);
	const ys = Array.from(loop).filter((_, i) => i % 2 === 1);
	return {
		key,
		depth,
		height,
		loop,
		curve: loop,
		bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) },
		top: { x: 0, y: 0 },
		bottom: { x: 0, y: 0 },
	};
};

const label = (key: string, box: { x: number; y: number; w: number; h: number }, alpha = 1): RegionLabel => ({
	key,
	region: { key } as DrawRegion,
	box,
	glyph: { x: box.x + 8, y: box.y + 9, r: 5 },
	badge: null,
	title: key,
	titleAt: { x: box.x + 20, y: box.y + 9 },
	bar: { x: 0, y: 0, w: 0, h: 0 },
	segments: [],
	toggle: { x: box.x + box.w - 10, y: box.y + 9, r: 6 },
	alpha,
});

const control = (key: string, x: number, y: number, collapse = true): CollapseControl => ({ key, collapse, at: { x, y, r: 6 }, alpha: 1 });

function index(over: Partial<HitInput> = {}): HitIndex {
	return new HitIndex({ transform, level: 'middle', dots: [], cards: [], labels: [], controls: [], outlines: [], ...over });
}

describe('hit testing', () => {
	it('finds a dot where it is drawn, and nothing in empty ground', () => {
		const hits = index({ dots: [dot('A', 100, 100)] });
		expect(hits.at({ x: 102, y: 101 }, false)).toEqual({ type: 'dot', key: 'A', part: 'glyph' });
		expect(hits.at({ x: 300, y: 300 }, false)).toBeNull();
	});

	it('gives a small dot a reachable target, and a coarse pointer 44 px across', () => {
		// A leaf at fit all draws 2 px in radius.
		const small = index({ dots: [dot('A', 100, 100, 1)] });
		expect(small.at({ x: 100 + FINE_MIN_RADIUS - 1, y: 100 }, false)?.type).toBe('dot');
		expect(small.at({ x: 100 + FINE_MIN_RADIUS + 4, y: 100 }, false)).toBeNull();
		expect(small.at({ x: 100 + COARSE_MIN_RADIUS - 1, y: 100 }, true)?.type).toBe('dot');
		expect(small.at({ x: 100 + COARSE_MIN_RADIUS + 3, y: 100 }, true)).toBeNull();
	});

	it('takes the nearest dot where coarse targets overlap', () => {
		const hits = index({ dots: [dot('A', 100, 100), dot('B', 112, 100)] });
		expect(hits.at({ x: 105, y: 100 }, true)).toMatchObject({ key: 'A' });
		expect(hits.at({ x: 109, y: 100 }, true)).toMatchObject({ key: 'B' });
	});

	it('hits a card anywhere on its body, as its dot, and the glyph as the glyph', () => {
		const a = dot('A', 100, 100);
		const hits = index({ level: 'near', dots: [a], cards: [a] });
		const box = cardBox(a, transform);
		expect(hits.at({ x: 100, y: 100 }, false)).toEqual({ type: 'dot', key: 'A', part: 'glyph' });
		expect(hits.at({ x: box.x + box.w - 10, y: box.y + box.h - 10 }, false)).toEqual({ type: 'dot', key: 'A', part: 'card' });
		expect(hits.at({ x: box.x + box.w + 10, y: box.y }, false)).toBeNull();
	});

	it('finds the region a point is inside, the innermost of nested ones', () => {
		const outer = outline('OUTER', square(0, 0, 400, 400), 2, 0);
		const inner = outline('INNER', square(100, 100, 200, 200), 1, 1);
		const hits = index({ outlines: [outer, inner] });
		expect(hits.at({ x: 150, y: 150 }, false)).toEqual({ type: 'region', key: 'INNER' });
		expect(hits.at({ x: 300, y: 300 }, false)).toEqual({ type: 'region', key: 'OUTER' });
		expect(hits.at({ x: 500, y: 500 }, false)).toBeNull();
	});

	it('follows the camera: outlines are tested in layout units', () => {
		const hits = index({ transform: { k: 2, x: 50, y: 0 }, outlines: [outline('R', square(0, 0, 100, 100), 1, 0)] });
		expect(hits.at({ x: 100, y: 100 }, false)).toEqual({ type: 'region', key: 'R' });
		expect(hits.at({ x: 40, y: 100 }, false)).toBeNull();
	});

	describe('precedence', () => {
		const region = outline('R', square(0, 0, 400, 400), 1, 0);

		it('a dot wins over the region it sits in', () => {
			expect(index({ dots: [dot('A', 100, 100)], outlines: [region] }).at({ x: 100, y: 100 }, false)).toMatchObject({ type: 'dot' });
		});

		it('a region label wins over the ground under it, and a faded one does not', () => {
			const pill = { x: 80, y: 80, w: 120, h: 18 };
			expect(index({ labels: [label('R', pill)], outlines: [region] }).at({ x: 100, y: 90 }, false)).toEqual({ type: 'label', key: 'R' });
			expect(index({ labels: [label('R', pill, 0.2)], outlines: [region] }).at({ x: 100, y: 90 }, false)).toEqual({ type: 'region', key: 'R' });
		});

		it('a collapse control wins over the label it ends and over a dot it sits beside', () => {
			const pill = { x: 80, y: 80, w: 120, h: 18 };
			const toggle = control('R', 190, 89);
			const hits = index({ labels: [label('R', pill)], controls: [toggle], outlines: [region], dots: [dot('A', 215, 89)] });
			expect(hits.at({ x: 190, y: 89 }, false)).toEqual({ type: 'control', key: 'R', collapse: true });
			// Off the control, the dot is next.
			expect(hits.at({ x: 208, y: 89 }, false)?.type).toBe('dot');
		});

		it('gives a coarse pointer a 44 px control', () => {
			const hits = index({ controls: [control('R', 100, 100)] });
			expect(hits.at({ x: 100 + 15, y: 100 }, false)).toBeNull();
			expect(hits.at({ x: 100 + 15, y: 100 }, true)).toMatchObject({ type: 'control' });
		});
	});
});

describe('point in polygon', () => {
	it('is even-odd over the loop', () => {
		const loop = square(0, 0, 10, 10);
		expect(contains(loop, 5, 5)).toBe(true);
		expect(contains(loop, 15, 5)).toBe(false);
		expect(contains(loop, 5, -1)).toBe(false);
		const concave = new Float64Array([0, 0, 10, 0, 10, 10, 6, 10, 6, 4, 4, 4, 4, 10, 0, 10]);
		expect(contains(concave, 5, 7)).toBe(false);
		expect(contains(concave, 2, 7)).toBe(true);
	});
});
