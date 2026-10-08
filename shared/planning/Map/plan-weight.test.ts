import { describe, expect, it } from 'vitest';
import { planWeights, ringScale, tintAmount, weightedRadius } from './plan-weight';

describe('plan weight', () => {
	it('runs from full weight at the top of the plan to none at the bottom, falling fastest near the top', () => {
		const weights = planWeights(['A', 'B', 'C', 'D', 'E']);
		expect(weights.get('A')).toBe(1);
		expect(weights.get('E')).toBe(0);
		const steps = ['A', 'B', 'C', 'D', 'E'].map((key) => weights.get(key)!);
		for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThan(steps[i - 1]!);
		expect(steps[0]! - steps[1]!).toBeGreaterThan(steps[3]! - steps[4]!);
	});

	it('gives a plan of one full weight, and leaves unplanned items out', () => {
		expect(planWeights(['A'])).toEqual(new Map([['A', 1]]));
		expect(planWeights([]).size).toBe(0);
	});

	it('weighs each project down its own plan on a combined Map, so every project\'s top is at full weight', () => {
		const weights = planWeights(['PLN-4', 'PLN-1', 'SPE-9', 'SPE-3', 'SPE-12']);
		expect(weights.get('PLN-4')).toBe(1);
		expect(weights.get('PLN-1')).toBe(0);
		expect(weights.get('SPE-9')).toBe(1);
		expect(weights.get('SPE-3')).toBe(planWeights(['SPE-9', 'SPE-3', 'SPE-12']).get('SPE-3'));
		expect(weights.get('SPE-12')).toBe(0);
	});

	it('takes the bottom of the plan to 78% of its size and 60% of its ring, and full weight changes nothing', () => {
		expect(weightedRadius(5.5, 1)).toBe(5.5);
		expect(weightedRadius(5.5, 0)).toBeCloseTo(5.5 * 0.78);
		expect(ringScale(1)).toBe(1);
		expect(ringScale(0)).toBeCloseTo(0.6);
	});

	it('tints toward the surface, as far as 35% of the color, but never past the contrast floor', () => {
		expect(tintAmount(1, 0.86)).toBe(1);
		expect(tintAmount(0, 0.86)).toBe(0.86);
		expect(tintAmount(0, 0.2)).toBeCloseTo(0.35);
		expect(tintAmount(0.5, 0.2)).toBeCloseTo(0.675);
	});
});
