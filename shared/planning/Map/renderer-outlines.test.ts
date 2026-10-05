import { describe, expect, it } from 'vitest';
import { outlineGap } from './renderer';

describe('how far a drawn outline is simplified', () => {
	it('keeps every curve close in, where a curve is a grid step long and a pixel is smaller than that', () => {
		expect(outlineGap(1)).toBe(0);
		expect(outlineGap(0.5)).toBe(0);
		expect(outlineGap(8)).toBe(0);
	});

	it('merges curves closer than a pixel or two on screen, further out, in powers of two', () => {
		const gaps = [0.3, 0.1, 0.05, 0.03, 0.01].map(outlineGap);
		expect(gaps.every((gap) => gap >= 4 && Math.log2(gap) % 1 === 0)).toBe(true);
		expect([...gaps].sort((a, b) => a - b)).toEqual(gaps);
		// Close to 1.5 screen pixels, so what is dropped is below what the eye resolves.
		for (const k of [0.3, 0.1, 0.05, 0.03, 0.01]) {
			const px = outlineGap(k) * k;
			expect(px).toBeGreaterThan(0.9);
			expect(px).toBeLessThan(2.2);
		}
	});

	it('changes only when the gap doubles, so a zoom redraws an outline\'s path rarely and a pan never', () => {
		expect(outlineGap(0.051)).toBe(outlineGap(0.049));
		expect(outlineGap(0.05)).not.toBe(outlineGap(0.025));
	});
});
