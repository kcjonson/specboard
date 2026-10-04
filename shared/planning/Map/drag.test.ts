import { describe, expect, it } from 'vitest';
import { SPRING_MS, springRemaining } from './drag';

describe('the spring a dragged dot returns on', () => {
	it('starts with all of the pull and ends with none', () => {
		expect(springRemaining(0)).toBe(1);
		expect(springRemaining(1)).toBe(0);
		expect(SPRING_MS).toBe(300);
	});

	it('crosses home early, swings back past it by about a tenth, and settles', () => {
		const samples = Array.from({ length: 100 }, (_, i) => springRemaining(i / 100));
		const crossing = samples.findIndex((value) => value < 0);
		expect(crossing).toBeGreaterThan(0);
		expect(crossing).toBeLessThan(30);
		const overshoot = Math.min(...samples);
		expect(overshoot).toBeLessThan(-0.05);
		expect(overshoot).toBeGreaterThan(-0.2);
		expect(Math.abs(samples[90]!)).toBeLessThan(0.02);
	});
});
