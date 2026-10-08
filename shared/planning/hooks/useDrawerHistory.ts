import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { navigate } from '@specboard/router';
import type { ItemModel } from '@specboard/models';

export interface DrawerHistory {
	/** The card or row marked as selected; the arrow keys move it, and the open item is it. */
	selectedItemKey: string | undefined;
	/** Moves the selection. With the drawer open it follows live, replacing the history entry rather than pushing one per keystroke. */
	select: (item: ItemModel | undefined) => void;
	/** Opens an item in the drawer, or moves the open drawer to it. */
	open: (itemKey: string) => void;
	/** Closes the drawer, keeping the selection. */
	close: () => void;
}

function inField(target: EventTarget | null): boolean {
	const element = target as HTMLElement | null;
	return element !== null && (
		element.tagName === 'INPUT' ||
		element.tagName === 'TEXTAREA' ||
		element.tagName === 'SELECT' ||
		element.isContentEditable
	);
}

/**
 * The history model for a planning page's item drawer, which one project's planning and the
 * multi-project view share. Which item is open lives in the page's address (`openItemKey`
 * is read from it, `addressFor` writes it), so every path that opens or closes the drawer
 * is a navigation:
 *   - opening from the view is a new place          -> push, so Back closes it
 *   - moving between items while already open       -> replace, so browsing ten
 *     items doesn't leave ten entries to Back through
 *   - closing                                       -> undo our own push (below)
 * Card clicks call `select` *then* `open`, so without the replace-when-open rule the
 * select's navigation would land first and silently swallow the open's push.
 *
 * `closeOnEscape` is for a view with no keyboard handling of its own (the Table): Escape
 * anywhere outside a field clears the selection and closes the drawer. The Board's
 * keyboard hook and the Map handle their own Escape, and the drawer's own handler stops
 * propagation when focus is inside it.
 */
export function useDrawerHistory(
	openItemKey: string | undefined,
	addressFor: (itemKey: string | undefined) => string,
	closeOnEscape: boolean
): DrawerHistory {
	// Seeded from the address so a page that opens on an item lands with it selected, and
	// kept in step below whenever the address moves on its own.
	const [selectedItemKey, setSelectedItemKey] = useState<string | undefined>(openItemKey);
	// The address the drawer was opened from, where Back from the entry our push made lands.
	const openedFrom = useRef<string | null>(null);

	// A navigation from elsewhere, or Back and Forward across item addresses.
	useEffect(() => {
		if (openItemKey) setSelectedItemKey(openItemKey);
		else openedFrom.current = null;
	}, [openItemKey]);

	const select = useCallback((item: ItemModel | undefined): void => {
		setSelectedItemKey(item?.key);
		if (!openItemKey) return;
		navigate(addressFor(item?.key), { replace: true });
	}, [openItemKey, addressFor]);

	const open = useCallback((itemKey: string): void => {
		setSelectedItemKey(itemKey);
		if (openItemKey) {
			navigate(addressFor(itemKey), { replace: true });
		} else {
			openedFrom.current = window.location.pathname + window.location.search + window.location.hash;
			navigate(addressFor(itemKey));
		}
	}, [openItemKey, addressFor]);

	// Closing undoes our own push where there is one, which leaves the history exactly as
	// it was before the drawer opened. Replacing instead would strand a duplicate entry for
	// the view, making the next Back appear to do nothing; pushing would make Back reopen
	// the drawer. Back is only right while it lands where closing should, though: a view
	// picked, a Map anchor moved, or a filter changed since the drawer opened has moved the
	// address on, and Back would undo that and leave the drawer open. Then, and when the
	// drawer was opened by a navigation from elsewhere, a reload, or Back and Forward, it
	// closes in place.
	const close = useCallback((): void => {
		const closed = addressFor(undefined);
		const from = openedFrom.current;
		openedFrom.current = null;
		if (from === closed) {
			window.history.back();
			return;
		}
		navigate(closed, { replace: true });
	}, [addressFor]);

	useEffect(() => {
		if (!closeOnEscape || !openItemKey) return;
		const onKeyDown = (e: KeyboardEvent): void => {
			if (e.key !== 'Escape' || inField(e.target)) return;
			setSelectedItemKey(undefined);
			close();
		};
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [closeOnEscape, openItemKey, close]);

	return { selectedItemKey, select, open, close };
}
