import { describe, expect, it } from 'vitest';
import { centerOf, fitScale, fitTransform } from '../camera';
import type { MapBounds } from '../layout/types';
import {
	MINIMAP_ENTER,
	MINIMAP_EXIT,
	MINIMAP_MARGIN,
	MINIMAP_MAX_HEIGHT,
	MINIMAP_MAX_WIDTH,
	MINIMAP_PAD,
	fromMinimap,
	minimapPanel,
	minimapShows,
	minimapSize,
	minimapViewport,
	toMinimap,
} from './minimap';

const bounds: MapBounds = { minX: -2000, maxX: 400, minY: -300, maxY: 300 };
const plot = { width: 1200, height: 700 };

describe('minimap geometry', () => {
	it('fits the whole Map in the box that is allowed, keeping its shape', () => {
		const size = minimapSize(bounds);
		expect(size.width).toBeLessThanOrEqual(MINIMAP_MAX_WIDTH);
		expect(size.height).toBeLessThanOrEqual(MINIMAP_MAX_HEIGHT);
		// 2400 by 600 is 4:1, so the width is what limits it.
		expect(size.width).toBeCloseTo(MINIMAP_MAX_WIDTH);
		expect(size.width / size.height).toBeCloseTo(4);

		const tall = minimapSize({ minX: 0, maxX: 100, minY: 0, maxY: 800 });
		expect(tall.height).toBeCloseTo(MINIMAP_MAX_HEIGHT);
		expect(tall.width).toBeLessThan(MINIMAP_MAX_WIDTH);
	});

	it('puts the panel in the plot\'s lower left, above the ruler, with its border and padding around the miniature', () => {
		const size = minimapSize(bounds);
		const panel = minimapPanel(size, plot);
		expect(panel.x).toBe(MINIMAP_MARGIN);
		expect(panel.y + panel.h).toBe(plot.height - MINIMAP_MARGIN);
		expect(panel.w).toBeCloseTo(size.width + 2 * MINIMAP_PAD);
		expect(panel.h).toBeCloseTo(size.height + 2 * MINIMAP_PAD);
	});

	it('maps a layout point into the miniature and back', () => {
		const size = minimapSize(bounds);
		expect(toMinimap(size, bounds, { x: bounds.minX, y: bounds.minY })).toEqual({ x: 0, y: 0 });
		const far = toMinimap(size, bounds, { x: bounds.maxX, y: bounds.maxY });
		expect(far.x).toBeCloseTo(size.width);
		expect(far.y).toBeCloseTo(size.height);
		const point = { x: -700, y: 120 };
		const back = fromMinimap(size, bounds, toMinimap(size, bounds, point));
		expect(back.x).toBeCloseTo(point.x);
		expect(back.y).toBeCloseTo(point.y);
	});

	it('holds a click outside the Map to the Map\'s edge', () => {
		const size = minimapSize(bounds);
		expect(fromMinimap(size, bounds, { x: -50, y: -50 })).toEqual({ x: bounds.minX, y: bounds.minY });
		expect(fromMinimap(size, bounds, { x: 9999, y: 9999 })).toEqual({ x: bounds.maxX, y: bounds.maxY });
	});

	it('marks the viewport as the share of the Map the plot shows', () => {
		const size = minimapSize(bounds);
		// Scale 1, with the plot's middle on the Map's middle.
		const transform = { k: 1, x: plot.width / 2 + 800, y: plot.height / 2 };
		const marked = minimapViewport(size, bounds, transform, plot);
		expect(marked.w).toBeCloseTo(plot.width * size.scale);
		expect(marked.h).toBeCloseTo(Math.min(size.height, plot.height * size.scale));
		const middle = toMinimap(size, bounds, centerOf(transform, plot));
		expect(marked.x + marked.w / 2).toBeCloseTo(middle.x);
	});

	it('is the whole miniature at fit all, and cut to the miniature when the camera sits past the Map\'s edge', () => {
		const size = minimapSize(bounds);
		const fit = minimapViewport(size, bounds, fitTransform(bounds, plot), plot);
		expect(fit.x).toBeCloseTo(0, 0);
		expect(fit.w).toBeCloseTo(size.width, 0);

		const pastTheEdge = minimapViewport(size, bounds, { k: 1, x: 500, y: plot.height / 2 }, plot);
		expect(pastTheEdge.x + pastTheEdge.w).toBeLessThanOrEqual(size.width + 1e-9);
		expect(pastTheEdge.x).toBeGreaterThanOrEqual(0);
		const away = minimapViewport(size, bounds, { k: 1, x: 99999, y: 0 }, plot);
		expect(away.w).toBe(0);
	});
});

describe('minimapShows', () => {
	const fit = fitScale(bounds, plot);

	it('is hidden at fit all and shown once zoomed in past it', () => {
		expect(minimapShows(fit, fit, false)).toBe(false);
		expect(minimapShows(fit * 1.05, fit, false)).toBe(false);
		expect(minimapShows(fit * MINIMAP_ENTER, fit, false)).toBe(true);
		expect(minimapShows(fit * 4, fit, false)).toBe(true);
	});

	it('does not flicker at the threshold: once shown it stays until the camera is well back', () => {
		let shown = false;
		let flips = 0;
		for (let i = 0; i < 100; i++) {
			const k = fit * MINIMAP_ENTER * (i % 2 === 0 ? 1.01 : 0.99);
			const next = minimapShows(k, fit, shown);
			if (next !== shown) flips++;
			shown = next;
		}
		expect(flips).toBe(1);
		expect(minimapShows(fit * (MINIMAP_EXIT - 0.01), fit, true)).toBe(false);
	});
});
