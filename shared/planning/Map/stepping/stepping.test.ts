import { describe, expect, it } from 'vitest';
import { nextStep, stepText } from './stepping';

describe('stepping through a list', () => {
	it('goes forward from the first item and back from the last when nothing has been stepped to', () => {
		expect(nextStep(-1, 1, 5)).toBe(0);
		expect(nextStep(-1, -1, 5)).toBe(4);
	});

	it('moves one at a time, in the list\'s order', () => {
		expect(nextStep(0, 1, 5)).toBe(1);
		expect(nextStep(3, -1, 5)).toBe(2);
	});

	it('wraps around both ends', () => {
		expect(nextStep(4, 1, 5)).toBe(0);
		expect(nextStep(0, -1, 5)).toBe(4);
		expect(nextStep(0, 1, 1)).toBe(0);
		expect(nextStep(0, -1, 1)).toBe(0);
	});

	it('has nowhere to go in an empty list', () => {
		expect(nextStep(-1, 1, 0)).toBe(-1);
		expect(nextStep(0, -1, 0)).toBe(-1);
	});

	it('reads "2 of 5" once stepping, and a count before', () => {
		expect(stepText(1, 5, ['match', 'matches'])).toBe('2 of 5');
		expect(stepText(-1, 5, ['match', 'matches'])).toBe('5 matches');
		expect(stepText(-1, 1, ['change', 'changes'])).toBe('1 change');
	});
});
