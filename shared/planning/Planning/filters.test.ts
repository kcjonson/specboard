/**
 * usePlanningFilters: the toolbar filters both planning views share, and when the
 * search they hold becomes a query.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/preact';
import { usePlanningFilters } from './filters';

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

function typed(value: string): Event {
	return { target: { value } } as unknown as Event;
}

/** Moves the clock and lets what it fires render. */
const wait = (ms: number): Promise<void> => act(async () => {
	await vi.advanceTimersByTimeAsync(ms);
});

describe('usePlanningFilters', () => {
	it('starts from what it is given, or from nothing', () => {
		expect(renderHook(() => usePlanningFilters()).result.current).toMatchObject({
			filters: { search: '', category: 'all' },
			settledSearch: '',
			type: undefined,
			active: false,
		});
		expect(renderHook(() => usePlanningFilters({ search: 'auth', type: 'bug' })).result.current).toMatchObject({
			filters: { search: 'auth', category: 'bug' },
			settledSearch: 'auth',
			type: 'bug',
			active: true,
		});
	});

	it('settles typing a quarter second after it stops, and applies the type at once', async () => {
		const { result } = renderHook(() => usePlanningFilters());

		act(() => result.current.onSearchInput(typed('au')));
		await wait(200);
		act(() => result.current.onSearchInput(typed('auth')));
		await wait(200);
		expect(result.current.settledSearch).toBe('');
		await wait(50);
		expect(result.current.settledSearch).toBe('auth');

		act(() => result.current.onCategoryChange(typed('task')));
		expect(result.current.type).toBe('task');
		act(() => result.current.onCategoryChange(typed('all')));
		expect(result.current.type).toBeUndefined();
	});

	it('settles an emptied box, a clear, and a restore without waiting', async () => {
		const { result } = renderHook(() => usePlanningFilters({ search: 'auth' }));

		act(() => result.current.onSearchInput(typed('')));
		await wait(0);
		expect(result.current.settledSearch).toBe('');

		act(() => result.current.restore({ search: 'oauth', type: 'bug' }));
		expect(result.current).toMatchObject({ settledSearch: 'oauth', type: 'bug', active: true });

		act(() => result.current.clear());
		expect(result.current).toMatchObject({ filters: { search: '', category: 'all' }, settledSearch: '', active: false });
	});
});
