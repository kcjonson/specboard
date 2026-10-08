import { describe, expect, it } from 'vitest';
import { upNextNumbers } from './up-next';

describe('upNextNumbers', () => {
	it('numbers a project\'s up next 1 to 3 in order', () => {
		expect([...upNextNumbers(['SPE-9', 'SPE-2', 'SPE-14'])]).toEqual([['SPE-9', 1], ['SPE-2', 2], ['SPE-14', 3]]);
	});

	it('starts every project\'s run again at 1 on a combined Map', () => {
		const numbers = upNextNumbers(['PLN-3', 'PLN-8', 'SPE-9', 'SPE-2', 'SPE-14']);
		expect(Object.fromEntries(numbers)).toEqual({ 'PLN-3': 1, 'PLN-8': 2, 'SPE-9': 1, 'SPE-2': 2, 'SPE-14': 3 });
	});

	it('works the numbers out once per layout', () => {
		const upNext = ['SPE-1'];
		expect(upNextNumbers(upNext)).toBe(upNextNumbers(upNext));
	});
});
