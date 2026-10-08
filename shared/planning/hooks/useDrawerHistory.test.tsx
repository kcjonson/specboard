/**
 * The item drawer's history model, which one project's planning and the multi-project
 * view share: opening pushes, moving while open replaces, and closing goes back only while
 * Back lands where closing should, closing in place otherwise.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor, type RenderHookResult } from '@testing-library/preact';
import type { ItemModel } from '@specboard/models';
import { navigate } from '@specboard/router';
import { withQuery } from '../utils/address';
import { useDrawerHistory, type DrawerHistory } from './useDrawerHistory';

/** The page's address names the open item, as `?item=` does on the multi-project view. */
function addressFor(itemKey: string | undefined): string {
	return withQuery(window.location, { item: itemKey });
}

/** The open item, as the page reads it: only keys of this page's items count. */
function openInAddress(): string | undefined {
	const key = new URLSearchParams(window.location.search).get('item');
	return key?.startsWith('A-') ? key : undefined;
}

/**
 * The hook as a page mounts it, re-rendered after each navigation the way the router
 * re-renders the page. Arriving is a push, which also drops any entries an earlier test
 * left ahead of this one, so history lengths compare within the test.
 */
function mountAt(address: string, closeOnEscape = false): RenderHookResult<DrawerHistory, unknown> {
	window.history.pushState(null, '', address);
	return renderHook(() => useDrawerHistory(openInAddress(), addressFor, closeOnEscape));
}

function itemFor(key: string): ItemModel {
	return { key } as ItemModel;
}

/** The address as it reads after the popstate a Back fires, which lands a tick later. */
async function landed(search: string): Promise<void> {
	await waitFor(() => expect(window.location.search).toBe(search));
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('useDrawerHistory', () => {
	it('pushes on open, replaces while moving between items, and closing goes back', async () => {
		const { result, rerender } = mountAt('/board?view=board');
		const before = window.history.length;
		const back = vi.spyOn(window.history, 'back');

		act(() => result.current.open('A-1'));
		rerender();
		expect(window.location.search).toBe('?view=board&item=A-1');
		expect(window.history.length).toBe(before + 1);

		act(() => result.current.open('A-2'));
		rerender();
		expect(window.location.search).toBe('?view=board&item=A-2');
		expect(window.history.length).toBe(before + 1);
		expect(result.current.selectedItemKey).toBe('A-2');

		act(() => result.current.close());
		expect(back).toHaveBeenCalledTimes(1);
		await landed('?view=board');
		rerender();
		expect(result.current.selectedItemKey).toBe('A-2');

		// A real step back: the drawer's entry is still ahead.
		window.history.forward();
		await landed('?view=board&item=A-2');
	});

	it('closes in place after views picked since, even one back where it started', () => {
		const { result, rerender } = mountAt('/board?view=board');
		const back = vi.spyOn(window.history, 'back');
		act(() => result.current.open('A-1'));
		rerender();

		// Two picks with the drawer open, each an entry of its own, the second back on the Board.
		act(() => navigate('/board?view=table&item=A-1'));
		act(() => navigate('/board?view=board&item=A-1'));
		rerender();
		const length = window.history.length;

		act(() => result.current.close());
		rerender();
		expect(back).not.toHaveBeenCalled();
		expect(window.location.search).toBe('?view=board');
		expect(window.history.length).toBe(length);
	});

	it('goes back after only the Map\'s anchor moved in place, which lands where the drawer opened', async () => {
		const { result, rerender } = mountAt('/board?view=map&focus=A-9');
		const back = vi.spyOn(window.history, 'back');
		act(() => result.current.open('A-1'));
		rerender();

		// Panning replaces the entry, keeping its state, as the Map's anchor does.
		window.history.replaceState(window.history.state, '', '/board?view=map&focus=A-4&item=A-1');

		act(() => result.current.close());
		expect(back).toHaveBeenCalledTimes(1);
		await landed('?view=map&focus=A-9');
	});

	it('closes in place, keeping it, after a filter changed with the drawer open', () => {
		const { result, rerender } = mountAt('/board?view=board');
		const back = vi.spyOn(window.history, 'back');
		act(() => result.current.open('A-1'));
		rerender();

		window.history.replaceState(window.history.state, '', '/board?view=board&item=A-1&search=auth');

		act(() => result.current.close());
		rerender();
		expect(back).not.toHaveBeenCalled();
		expect(window.location.search).toBe('?view=board&search=auth');
	});

	it('closes in place when the address opened the drawer (a reload, a link)', () => {
		const { result, rerender } = mountAt('/board?item=A-1');
		const before = window.history.length;
		const back = vi.spyOn(window.history, 'back');
		expect(result.current.selectedItemKey).toBe('A-1');

		act(() => result.current.close());
		rerender();
		expect(back).not.toHaveBeenCalled();
		expect(window.location.pathname + window.location.search).toBe('/board');
		expect(window.history.length).toBe(before);
	});

	it('goes back to where it was opened, whatever stale item the address carried there', async () => {
		const { result, rerender } = mountAt('/board?item=XYZ-1');
		const back = vi.spyOn(window.history, 'back');
		act(() => result.current.open('A-1'));
		rerender();
		expect(window.location.search).toBe('?item=A-1');

		act(() => result.current.close());
		expect(back).toHaveBeenCalledTimes(1);
		await landed('?item=XYZ-1');
	});

	it('moves only the selection while closed, follows it while open, and clearing it closes the drawer', async () => {
		const { result, rerender } = mountAt('/board');
		const before = window.history.length;
		const back = vi.spyOn(window.history, 'back');

		act(() => result.current.select(itemFor('A-3')));
		rerender();
		expect(result.current.selectedItemKey).toBe('A-3');
		expect(window.location.search).toBe('');

		act(() => result.current.open('A-3'));
		rerender();
		act(() => result.current.select(itemFor('A-4')));
		rerender();
		expect(window.location.search).toBe('?item=A-4');
		expect(window.history.length).toBe(before + 1);

		act(() => result.current.select(undefined));
		expect(back).toHaveBeenCalledTimes(1);
		await landed('');
		rerender();
		expect(result.current.selectedItemKey).toBeUndefined();
	});

	it('closes on Escape outside a field when asked to, clearing the selection', async () => {
		const { result, rerender } = mountAt('/board', true);
		act(() => result.current.open('A-1'));
		rerender();

		const field = document.body.appendChild(document.createElement('input'));
		act(() => {
			field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		});
		expect(window.location.search).toBe('?item=A-1');
		field.remove();

		act(() => {
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		});
		await landed('');
		rerender();
		expect(result.current.selectedItemKey).toBeUndefined();
	});

	it('leaves Escape alone when the view handles its own', () => {
		const { result, rerender } = mountAt('/board');
		act(() => result.current.open('A-1'));
		rerender();

		act(() => {
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		});
		expect(window.location.search).toBe('?item=A-1');
	});
});
