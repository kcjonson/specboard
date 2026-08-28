import { describe, it, expect, vi } from 'vitest';
import { VERSION, createId, deepClone, debounce, joinPath } from './index';

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

	describe('joinPath', () => {
		it('joins segments with a single slash', () => {
			expect(joinPath('docs', 'specs', 'auth.md')).toBe('docs/specs/auth.md');
		});

		it('collapses slashes at the seams', () => {
			expect(joinPath('docs/', '/specs/', '/auth.md')).toBe('docs/specs/auth.md');
		});

		it('keeps a leading slash on the first segment only', () => {
			expect(joinPath('/docs', '/specs')).toBe('/docs/specs');
		});

		it('drops segments that are nothing but slashes', () => {
			expect(joinPath('docs', '///', 'auth.md')).toBe('docs/auth.md');
		});

		it('stays fast on a long run of slashes that is not a trailing run', () => {
			// Guards the ReDoS fix. The slashes must NOT be at the end: /\/+$/ only goes
			// quadratic when the match fails and it retries from every offset. Measured at
			// this size the old regex took ~2.9s, the index scan ~1ms.
			const segment = '/'.repeat(40_000) + 'b';
			const start = Date.now();
			expect(joinPath(segment)).toBe(segment);
			expect(Date.now() - start).toBeLessThan(1000);
		});
	});
});
