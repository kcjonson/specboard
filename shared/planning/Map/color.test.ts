import { describe, expect, it } from 'vitest';
import { NON_TEXT_CONTRAST, contrast, contrastFloor, formatColor, mix, parseColor } from './color';

const rgb = (hex: string): ReturnType<typeof parseColor> & object => parseColor(hex)!;

describe('color', () => {
	it('reads the forms a canvas normalizes colors to', () => {
		expect(parseColor('#3b82f6')).toEqual({ r: 59, g: 130, b: 246 });
		expect(parseColor('#FFF')).toEqual({ r: 255, g: 255, b: 255 });
		expect(parseColor('rgba(26, 26, 26, 0.5)')).toEqual({ r: 26, g: 26, b: 26 });
		expect(parseColor('rgb(1,2,3)')).toEqual({ r: 1, g: 2, b: 3 });
		expect(parseColor('color-mix(in srgb, red, blue)')).toBeNull();
	});

	it('mixes in sRGB, as color-mix does', () => {
		expect(formatColor(mix(rgb('#000000'), rgb('#ffffff'), 0.5))).toBe('#808080');
		expect(formatColor(mix(rgb('#3b82f6'), rgb('#ffffff'), 1))).toBe('#3b82f6');
		expect(formatColor(mix(rgb('#3b82f6'), rgb('#ffffff'), 0))).toBe('#ffffff');
	});

	it('measures WCAG contrast', () => {
		expect(contrast(rgb('#000000'), rgb('#ffffff'))).toBeCloseTo(21);
		expect(contrast(rgb('#3b82f6'), rgb('#ffffff'))).toBeCloseTo(3.68, 2);
	});

	// The spec's own number: light Ready reaches the 3:1 floor at 86% of its color.
	it('finds the least of a color that still clears 3:1, light Ready at 86%', () => {
		const surface = rgb('#ffffff');
		const floor = contrastFloor(rgb('#3b82f6'), surface);
		expect(floor).toBeCloseTo(0.855, 2);
		expect(contrast(mix(rgb('#3b82f6'), surface, floor), surface)).toBeGreaterThanOrEqual(NON_TEXT_CONTRAST);
		expect(contrast(mix(rgb('#3b82f6'), surface, floor - 0.01), surface)).toBeLessThan(NON_TEXT_CONTRAST);
	});

	it('lets light Blocked and the dark marks go lighter, since they start further from the floor', () => {
		expect(contrastFloor(rgb('#64748b'), rgb('#ffffff'))).toBeCloseTo(0.756, 2);
		expect(contrastFloor(rgb('#3b82f6'), rgb('#1a1a1a'))).toBeCloseTo(0.709, 2);
		expect(contrastFloor(rgb('#94a3b8'), rgb('#1a1a1a'))).toBeCloseTo(0.555, 2);
	});

	it('never tints a color that doesn\'t clear the floor at full strength', () => {
		expect(contrastFloor(rgb('#f59e0b'), rgb('#ffffff'))).toBe(1);
	});
});
