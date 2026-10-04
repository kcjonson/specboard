import { describe, expect, it } from 'vitest';
import { MIN_DRAW_RADIUS } from './camera';
import { NEAR_GLYPH_RADIUS, dotBox, screenRadius } from './dot-boxes';
import { drawDot } from './draw-dot.fixture';
import { LEAF_RADIUS } from './layout/constants';

describe('glyph sizes', () => {
	const leaf = drawDot('L', 0, 0, { r: LEAF_RADIUS });
	const live = drawDot('P', 0, 0, { r: 8.5 });
	const big = drawDot('B', 0, 0, { r: 40 });
	const light = drawDot('W', 0, 0, { r: 4.3 });

	it('follows the zoom at the far and middle levels, never under the smallest the canvas draws', () => {
		expect(screenRadius(leaf, 3, 'middle')).toBeCloseTo(3 * LEAF_RADIUS);
		expect(screenRadius(leaf, 0.1, 'far')).toBe(MIN_DRAW_RADIUS);
	});

	it('holds still at the near level, whatever the scale: a card carries the same glyph', () => {
		expect(screenRadius(leaf, 4, 'near')).toBe(NEAR_GLYPH_RADIUS);
		expect(screenRadius(leaf, 7.9, 'near')).toBe(NEAR_GLYPH_RADIUS);
		expect(screenRadius(light, 5, 'near')).toBe(NEAR_GLYPH_RADIUS);
	});

	it('keeps larger things larger at the near level, up to one and a half times', () => {
		expect(screenRadius(live, 5, 'near')).toBeGreaterThan(NEAR_GLYPH_RADIUS);
		expect(screenRadius(big, 5, 'near')).toBeCloseTo(NEAR_GLYPH_RADIUS * 1.5);
	});

	it('boxes the whole drawn dot at the level it is drawn', () => {
		const near = dotBox(leaf, { k: 5, x: 100, y: 50 }, 'near');
		const middle = dotBox(leaf, { k: 5, x: 100, y: 50 }, 'middle');
		expect(near.w).toBeLessThan(middle.w);
		expect(near.x + near.w / 2).toBeCloseTo(100);
		expect(near.y + near.h / 2).toBeCloseTo(50);
	});
});
