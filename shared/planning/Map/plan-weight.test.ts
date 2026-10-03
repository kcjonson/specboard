import { describe, expect, it } from 'vitest';
import { MIN_WEIGHT, planWeights, ringScale, tintAmount, weightedRadius } from './plan-weight';

describe('plan weight', () => {
	it('runs from full weight at the top of the plan to the minimum at the bottom, falling fastest near the top', () => {
		const weights = planWeights(['A', 'B', 'C', 'D', 'E']);
		expect(weights.get('A')).toBe(1);
		expect(weights.get('E')).toBeCloseTo(MIN_WEIGHT);
		const steps = ['A', 'B', 'C', 'D', 'E'].map((key) => weights.get(key)!);
		for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThan(steps[i - 1]!);
		expect(steps[0]! - steps[1]!).toBeGreaterThan(steps[3]! - steps[4]!);
	});

	it('gives a plan of one full weight, and leaves unplanned items out', () => {
		expect(planWeights(['A'])).toEqual(new Map([['A', 1]]));
		expect(planWeights([]).size).toBe(0);
	});

	it('shrinks size and ring weight with the plan, and full weight changes nothing', () => {
		expect(weightedRadius(5.5, 1)).toBe(5.5);
		expect(weightedRadius(5.5, MIN_WEIGHT)).toBeCloseTo(5.5 * (0.78 + 0.22 * MIN_WEIGHT));
		expect(ringScale(1)).toBe(1);
		expect(ringScale(MIN_WEIGHT)).toBeLessThan(0.8);
	});

	it('tints toward the surface but stops at the contrast floor', () => {
		expect(tintAmount(1, 0.86)).toBe(1);
		expect(tintAmount(MIN_WEIGHT, 0.86)).toBe(0.86);
		expect(tintAmount(MIN_WEIGHT, 0.2)).toBeCloseTo(0.35 + 0.65 * MIN_WEIGHT);
	});
});
