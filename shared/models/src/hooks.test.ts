/**
 * @specboard/models - Hooks tests
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useModel } from './hooks';
import { Model } from './Model';
import { prop } from './prop';

// Test model
class Counter extends Model {
	@prop accessor count!: number;
}

describe('useModel', () => {
	it('should return the model instance', () => {
		const counter = new Counter({ count: 0 });
		const { result } = renderHook(() => useModel(counter));

		expect(result.current).toBe(counter);
	});

	it('should re-render when model changes via setter', () => {
		const counter = new Counter({ count: 0 });
		const { result } = renderHook(() => useModel(counter));

		expect(result.current.count).toBe(0);

		act(() => {
			counter.count = 5;
		});

		expect(result.current.count).toBe(5);
	});

	it('should re-render when model changes via set()', () => {
		const counter = new Counter({ count: 0 });
		const { result } = renderHook(() => useModel(counter));

		expect(result.current.count).toBe(0);

		act(() => {
			counter.set({ count: 10 });
		});

		expect(result.current.count).toBe(10);
	});

	it('should cleanup listener on unmount', () => {
		const counter = new Counter({ count: 0 });
		const { unmount } = renderHook(() => useModel(counter));

		// Get listener count before unmount
		const listenersBefore = (counter as unknown as { __listeners: Record<string, unknown[]> }).__listeners['change']?.length ?? 0;

		unmount();

		// Get listener count after unmount
		const listenersAfter = (counter as unknown as { __listeners: Record<string, unknown[]> }).__listeners['change']?.length ?? 0;

		expect(listenersAfter).toBe(listenersBefore - 1);
	});

	it('should handle multiple components using the same model', () => {
		const counter = new Counter({ count: 0 });

		const { result: result1 } = renderHook(() => useModel(counter));
		const { result: result2 } = renderHook(() => useModel(counter));

		expect(result1.current.count).toBe(0);
		expect(result2.current.count).toBe(0);

		act(() => {
			counter.count = 42;
		});

		expect(result1.current.count).toBe(42);
		expect(result2.current.count).toBe(42);
	});

	it('should re-subscribe when model changes', () => {
		const counter1 = new Counter({ count: 1 });
		const counter2 = new Counter({ count: 2 });

		let currentModel = counter1;
		const { result, rerender } = renderHook(() => useModel(currentModel));

		expect(result.current.count).toBe(1);

		// Switch to a different model
		currentModel = counter2;
		rerender();

		expect(result.current.count).toBe(2);

		// Changes to old model shouldn't affect the hook
		// (though in this simple test we can't easily verify no re-render)
		act(() => {
			counter2.count = 20;
		});

		expect(result.current.count).toBe(20);
	});
});
