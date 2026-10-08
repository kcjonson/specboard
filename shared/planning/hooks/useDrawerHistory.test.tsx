/**
 * The item drawer's history model, which one project's planning and the multi-project
 * view share: opening pushes, moving while open replaces, closing undoes its own push,
 * and the selection follows the drawer while it's open.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor, type RenderHookResult } from '@testing-library/preact';
import type { ItemModel } from '@specboard/models';
import { navigate } from '@specboard/router';
import { withQuery } from '../utils/address';
import { useDrawerHistory, type DrawerHistory } from './useDrawerHistory';

/** The page's address names the open item, as `?item=` does on the multi-project view. */
function addressFor(itemKey: string | undefined): string {
	return withQuery(window.location, { item: itemKey });
}

function openInAddress(): string | undefined {
	return new URLSearchParams(window.location.search).get('item') ?? undefined;
}

/**
 * The hook as a page mounts it, to be re-rendered after every navigation the way the router
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

describe('useDrawerHistory', () => {
	it('pushes on open, replaces while open, and closing undoes its own push', async () => {
		const { result, rerender } = mountAt('/board');
		const before = window.history.length;

		act(() => result.current.open('A-1'));
		rerender();
		expect(window.location.search).toBe('?item=A-1');
		expect(window.history.length).toBe(before + 1);

		act(() => result.current.open('A-2'));
		rerender();
		expect(window.location.search).toBe('?item=A-2');
		expect(window.history.length).toBe(before + 1);
		expect(result.current.selectedItemKey).toBe('A-2');

		act(() => result.current.close());
		await waitFor(() => expect(window.location.search).toBe(''));
		rerender();
		expect(result.current.selectedItemKey).toBe('A-2');
	});

	it('closes in place once the address has moved on since it opened, where Back would undo that instead', () => {
		const { result, rerender } = mountAt('/board?view=board');
		act(() => result.current.open('A-1'));
		rerender();

		// Another view picked with the drawer open: a history entry of its own.
		act(() => navigate('/board?view=table&item=A-1'));
		rerender();
		const length = window.history.length;

		act(() => result.current.close());
		rerender();
		expect(window.location.search).toBe('?view=table');
		expect(window.history.length).toBe(length);
	});

	it('closes in place when the address opened the drawer (a reload, a link)', () => {
		const { result, rerender } = mountAt('/board?item=A-1');
		const before = window.history.length;
		expect(result.current.selectedItemKey).toBe('A-1');

		act(() => result.current.close());
		rerender();
		expect(window.location.pathname + window.location.search).toBe('/board');
		expect(window.history.length).toBe(before);
	});

	it('moves only the selection while the drawer is closed, and the drawer with it while open', () => {
		const { result, rerender } = mountAt('/board');
		const before = window.history.length;

		act(() => result.current.select(itemFor('A-3')));
		rerender();
		expect(result.current.selectedItemKey).toBe('A-3');
		expect(window.location.search).toBe('');

		act(() => result.current.open('A-3'));
		rerender();
		act(() => result.current.select(itemFor('A-4')));
		rerender();
		expect(window.location.search).toBe('?item=A-4');

		act(() => result.current.select(undefined));
		rerender();
		expect(window.location.search).toBe('');
		expect(result.current.selectedItemKey).toBeUndefined();
		expect(window.history.length).toBe(before + 1);
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
		await waitFor(() => expect(window.location.search).toBe(''));
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
