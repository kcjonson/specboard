import { describe, it, expect, vi } from 'vitest';
import { VERSION, createId, deepClone, debounce } from './index';

describe('core', () => {
	describe('VERSION', () => {
		it('should be defined', () => {
			expect(VERSION).toBe('0.0.1');
		});
	});

	describe('createId', () => {
		it('should return a string', () => {
			const id = createId();
			expect(typeof id).toBe('string');
		});

		it('should return unique values', () => {
			const ids = new Set([createId(), createId(), createId()]);
			expect(ids.size).toBe(3);
		});
	});

	describe('deepClone', () => {
		it('should clone objects', () => {
			const original = { a: 1, b: { c: 2 } };
			const cloned = deepClone(original);
			expect(cloned).toEqual(original);
			expect(cloned).not.toBe(original);
			expect(cloned.b).not.toBe(original.b);
		});

		it('should clone arrays', () => {
			const original = [1, [2, 3]];
			const cloned = deepClone(original);
			expect(cloned).toEqual(original);
			expect(cloned).not.toBe(original);
		});
	});

	describe('debounce', () => {
		it('should debounce function calls', async () => {
			vi.useFakeTimers();
			const fn = vi.fn();
			const debounced = debounce(fn, 100);

			debounced();
			debounced();
			debounced();

			expect(fn).not.toHaveBeenCalled();

			vi.advanceTimersByTime(100);

			expect(fn).toHaveBeenCalledTimes(1);
			vi.useRealTimers();
		});
	});
});
