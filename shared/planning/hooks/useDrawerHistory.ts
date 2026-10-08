import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { navigate } from '@specboard/router';
import type { ItemModel } from '@specboard/models';
import { withQuery } from '../utils/address';

export interface DrawerHistory {
	/** The card or row marked as selected; the arrow keys move it, and the open item is it. */
	selectedItemKey: string | undefined;
	/**
	 * Moves the selection. With the drawer open it follows live, replacing the history entry
	 * rather than pushing one per keystroke, and clearing it (Escape) closes the drawer.
	 */
	select: (item: ItemModel | undefined) => void;
	/** Opens an item in the drawer, or moves the open drawer to it. */
	open: (itemKey: string) => void;
	/** Closes the drawer, keeping the selection. */
	close: () => void;
}

/** The key in `history.state` that marks the entry the drawer's opening pushed. */
const MARK = 'specboard.drawer';

/** Unique within this page load, and against marks a reload left in the history. */
const LOAD = Date.now().toString(36);
let opens = 0;

/** What closing needs to know about the drawer's opening. */
interface Opening {
	/** The view's address before the drawer opened, which Back from our entry returns to. */
	from: string;
	/** Carried in `history.state` by the entry our push made, and by no entry pushed since. */
	mark: string;
}

function stateWith(mark: string): Record<string, unknown> {
	const state: unknown = window.history.state;
	return { ...(typeof state === 'object' && state !== null ? state : {}), [MARK]: mark };
}

function markOfEntry(): unknown {
	const state: unknown = window.history.state;
	return typeof state === 'object' && state !== null ? (state as Record<string, unknown>)[MARK] : undefined;
}

/** An address without the Map's anchor, which follows the camera as the person pans and so is never a place of its own. */
function withoutAnchor(address: string): string {
	return withQuery(new URL(address, window.location.origin), { focus: undefined });
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
	const opening = useRef<Opening | null>(null);

	// A navigation from elsewhere, or Back and Forward across item addresses.
	useEffect(() => {
		if (openItemKey) setSelectedItemKey(openItemKey);
		else opening.current = null;
	}, [openItemKey]);

	// The router writes a fresh state with every navigation, so a replace of our own puts the
	// mark back, on the entry our opening pushed and on no other: after a view picked or a Map
	// jump, the entry being replaced is that push's, and Back from it would reopen the drawer.
	const moveTo = useCallback((itemKey: string): void => {
		const mark = opening.current !== null && markOfEntry() === opening.current.mark ? opening.current.mark : null;
		navigate(addressFor(itemKey), { replace: true });
		if (mark !== null) window.history.replaceState(stateWith(mark), '');
	}, [addressFor]);

	// Closing undoes our own push where Back lands where closing should, which leaves the
	// history exactly as it was before the drawer opened. That's while the entry is still the
	// one our push made: a view picked or a Map jump since pushes an entry of its own, and Back
	// would undo that instead, drawer open. And while nothing has changed in place since but
	// the Map's anchor, which Back returns to where the drawer opened: a filter changed with
	// the drawer open is the person's, and Back would take it away. Anything else closes in
	// place, as does a drawer opened by a link, a reload, or Back and Forward, where there is
	// nothing of ours to pop. Replacing where Back is right would strand a second entry for
	// the view, making the next Back appear to do nothing.
	const close = useCallback((): void => {
		const closed = addressFor(undefined);
		const was = opening.current;
		opening.current = null;
		if (was && markOfEntry() === was.mark && withoutAnchor(closed) === withoutAnchor(was.from)) {
			window.history.back();
			return;
		}
		navigate(closed, { replace: true });
	}, [addressFor]);

	const select = useCallback((item: ItemModel | undefined): void => {
		setSelectedItemKey(item?.key);
		if (!openItemKey) return;
		if (item) moveTo(item.key);
		else close();
	}, [openItemKey, moveTo, close]);

	const open = useCallback((itemKey: string): void => {
		setSelectedItemKey(itemKey);
		if (openItemKey) {
			moveTo(itemKey);
			return;
		}
		const from = addressFor(undefined);
		navigate(addressFor(itemKey));
		const mark = `${LOAD}-${++opens}`;
		window.history.replaceState(stateWith(mark), '');
		opening.current = { from, mark };
	}, [openItemKey, addressFor, moveTo]);

	useEffect(() => {
		if (!closeOnEscape || !openItemKey) return;
		const onKeyDown = (e: KeyboardEvent): void => {
			if (e.key !== 'Escape' || inField(e.target)) return;
			select(undefined);
		};
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [closeOnEscape, openItemKey, select]);

	return { selectedItemKey, select, open, close };
}
