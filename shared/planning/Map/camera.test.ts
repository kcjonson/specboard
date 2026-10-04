import { describe, expect, it } from 'vitest';
import {
	FIT_PADDING,
	MAX_SCALE,
	NOW_ZOOM,
	READABLE_DOT_RADIUS,
	centerOf,
	constrainTransform,
	cubicBezier,
	dotsVisible,
	fitScale,
	fitTransform,
	MIN_DRAW_RADIUS,
	focusTransform,
	nearestDot,
	nowTransform,
	openTransform,
	readableScale,
	type Dot,
	type Transform,
} from './camera';
import { LEAF_RADIUS } from './layout/constants';
import type { MapBounds } from './layout/types';

const viewport = { width: 1000, height: 500 };
const screen = (t: Transform, x: number, y: number): { x: number; y: number } => ({ x: t.x + t.k * x, y: t.y + t.k * y });

/** A Map that fits at a readable scale: 1,200 units wide, 340 tall. */
const small: MapBounds = { minX: -1000, maxX: 200, minY: -170, maxY: 170 };
/** One that doesn't: 4,200 wide. */
const wide: MapBounds = { minX: -4000, maxX: 200, minY: -170, maxY: 170 };

const dot = (key: string, x: number, y: number, r = LEAF_RADIUS): Dot => ({ key, x, y, r });

describe('readable scale', () => {
	it('is the scale at which the smallest dot is READABLE_DOT_RADIUS pixels across its radius', () => {
		expect(readableScale() * LEAF_RADIUS).toBeCloseTo(READABLE_DOT_RADIUS);
	});
});

describe('fit all', () => {
	it('scales the bounds into the plot with padding on the tighter side', () => {
		// Width is the tighter side here: 952 px for 1200 units.
		expect(fitScale(small, viewport)).toBeCloseTo((1000 - 2 * FIT_PADDING) / 1200);
	});

	it('centers the bounds', () => {
		const t = fitTransform(small, viewport);
		expect(screen(t, -400, 0).x).toBeCloseTo(500);
		expect(screen(t, 0, 0).y).toBeCloseTo(250);
		expect(centerOf(t, viewport)).toEqual({ x: expect.closeTo(-400), y: expect.closeTo(0) });
	});

	it('keeps every edge of the bounds inside the plot', () => {
		const t = fitTransform(wide, viewport);
		expect(screen(t, wide.minX, wide.minY).x).toBeGreaterThanOrEqual(FIT_PADDING - 1e-6);
		expect(screen(t, wide.maxX, wide.maxY).x).toBeLessThanOrEqual(viewport.width - FIT_PADDING + 1e-6);
		expect(screen(t, 0, wide.maxY).y).toBeLessThanOrEqual(viewport.height - FIT_PADDING + 1e-6);
	});
});

describe('the opening view (decision 11)', () => {
	it('is fit all when the whole Map fits at a readable scale', () => {
		expect(openTransform(small, [], viewport)).toEqual(fitTransform(small, viewport));
	});

	it('is the most recent stretch at the readable scale when it does not', () => {
		const dots = [dot('A', -3900, 100), dot('B', -300, -60), dot('C', 100, 40)];
		const t = openTransform(wide, dots, viewport);
		expect(t.k).toBeCloseTo(readableScale());
		// Now's edge of the Map against the plot's right padding.
		expect(screen(t, wide.maxX, 0).x).toBeCloseTo(viewport.width - FIT_PADDING);
		// Centered on the dots in the stretch it shows (B and C), not the far-left outlier.
		const middle = (-60 - LEAF_RADIUS + 40 + LEAF_RADIUS) / 2;
		expect(screen(t, 0, middle).y).toBeCloseTo(viewport.height / 2);
	});

	it('is also the opening scale for a Map too tall to fit', () => {
		const tall: MapBounds = { minX: -300, maxX: 100, minY: -4000, maxY: 4000 };
		expect(fitScale(tall, viewport)).toBeLessThan(readableScale());
		expect(openTransform(tall, [dot('A', 0, 0)], viewport).k).toBeCloseTo(readableScale());
	});
});

describe('Now', () => {
	it('zooms in on the right edge when the whole Map fits', () => {
		const t = nowTransform(small, [dot('A', 100, 0)], viewport);
		expect(t.k).toBeCloseTo(NOW_ZOOM * fitScale(small, viewport));
		expect(screen(t, small.maxX, 0).x).toBeCloseTo(viewport.width - FIT_PADDING);
	});

	it('stays at the opening scale when that is already closer', () => {
		const t = nowTransform(wide, [dot('A', 100, 0)], viewport);
		expect(t.k).toBeCloseTo(Math.max(readableScale(), NOW_ZOOM * fitScale(wide, viewport)));
	});

	it('never zooms past the maximum', () => {
		const tiny: MapBounds = { minX: -2, maxX: 2, minY: -1, maxY: 1 };
		expect(nowTransform(tiny, [], viewport).k).toBe(MAX_SCALE);
	});
});

describe('focusing an item', () => {
	const dots = [dot('A', -500, 80), dot('B', 100, 0)];

	it('puts the item in the middle of the plot', () => {
		const t = focusTransform(dots[0]!, small, dots, null, viewport);
		expect(screen(t, -500, 80)).toEqual({ x: expect.closeTo(500), y: expect.closeTo(250) });
	});

	it('keeps a zoom that is already closer in', () => {
		const t = focusTransform(dots[0]!, small, dots, { k: 3, x: 0, y: 0 }, viewport);
		expect(t.k).toBe(3);
	});

	it('is never smaller than the close scale, so a jump from fit all still lands on something', () => {
		const t = focusTransform(dots[0]!, small, dots, { k: fitScale(small, viewport), x: 0, y: 0 }, viewport);
		expect(t.k).toBeCloseTo(NOW_ZOOM * fitScale(small, viewport));
	});
});

describe('constraining a pan', () => {
	it('lets the plot center reach the edge of the Map and no further', () => {
		const t = constrainTransform({ k: 1, x: 100000, y: 0 }, small, viewport);
		expect(centerOf(t, viewport).x).toBeCloseTo(small.minX);
		const right = constrainTransform({ k: 1, x: -100000, y: 0 }, small, viewport);
		expect(centerOf(right, viewport).x).toBeCloseTo(small.maxX);
	});

	it('leaves a transform that is inside alone', () => {
		const t = fitTransform(small, viewport);
		const constrained = constrainTransform(t, small, viewport);
		expect(constrained.k).toBe(t.k);
		expect(constrained.x).toBeCloseTo(t.x);
		expect(constrained.y).toBeCloseTo(t.y);
	});
});

describe('an empty viewport', () => {
	const dots = [dot('A', 0, 0), dot('B', 2000, 0)];

	const drawnAt = (k: number) => (d: Dot): number => Math.max(d.r * k, MIN_DRAW_RADIUS);

	it('sees a dot in the plot', () => {
		expect(dotsVisible(dots, { k: 1, x: 100, y: 100 }, viewport, drawnAt(1))).toBe(true);
	});

	it('sees a dot only partly in the plot, by its drawn radius', () => {
		expect(dotsVisible([dot('A', 0, 0, 10)], { k: 1, x: -5, y: 100 }, viewport, drawnAt(1))).toBe(true);
		expect(dotsVisible([dot('A', 0, 0, 10)], { k: 1, x: -11, y: 100 }, viewport, drawnAt(1))).toBe(false);
	});

	it('uses the radius the dot is drawn at, which at the near level is not its layout size', () => {
		const edge = [dot('A', 0, 0, 10)];
		// 30 px past the plot's left edge: a 10 unit dot at scale 8 reaches it, an 8 px glyph does not.
		expect(dotsVisible(edge, { k: 8, x: -30, y: 100 }, viewport, drawnAt(8))).toBe(true);
		expect(dotsVisible(edge, { k: 8, x: -30, y: 100 }, viewport, () => 8)).toBe(false);
	});

	it('sees nothing in a stretch between two clusters', () => {
		expect(dotsVisible(dots, { k: 1, x: -400, y: 100 }, viewport, drawnAt(1))).toBe(false);
	});

	it('finds the nearest dot to a point', () => {
		expect(nearestDot(dots, { x: 1500, y: 10 })?.key).toBe('B');
		expect(nearestDot([], { x: 0, y: 0 })).toBeUndefined();
	});
});

describe('cubicBezier', () => {
	const ease = cubicBezier(0.2, 0, 0, 1);

	it('runs from 0 to 1', () => {
		expect(ease(0)).toBe(0);
		expect(ease(1)).toBe(1);
	});

	it('only goes up, and front-loads the move', () => {
		let previous = 0;
		for (let t = 0.05; t <= 1; t += 0.05) {
			const value = ease(t);
			expect(value).toBeGreaterThanOrEqual(previous);
			previous = value;
		}
		expect(ease(0.3)).toBeGreaterThan(0.5);
	});
});
