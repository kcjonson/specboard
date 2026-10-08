import { useEffect, useCallback } from 'preact/hooks';
import type { ItemModel, Status, ItemStatus } from '@specboard/models';

const DEFAULT_COLUMNS: ItemStatus[] = ['ready', 'in_progress', 'done'];

/** Where every key is someone else's: anything typed in, a dialog, and the item drawer, its own links included. */
const KEYS_OF_THEIR_OWN = [
	'input',
	'select',
	'textarea',
	'[contenteditable]:not([contenteditable="false"])',
	'dialog',
	'[role="dialog"]',
	'[data-item-drawer]',
].join(', ');

/** The keys a link or a button answers itself: they follow it or press it. */
const ACTIVATION_KEYS = new Set(['Enter', ' ']);

/**
 * Whether a key belongs to what it's aimed at rather than to the board. A field, a dialog,
 * or the drawer keeps every key. A link or a button keeps only the keys that activate it,
 * so the board's arrows, Escape, and shortcuts still work with one focused (the view toggle
 * after a click, a card's new-window button, Show more). A card opens itself on Enter.
 */
function handledElsewhere(e: KeyboardEvent): boolean {
	const target = e.target instanceof Element ? e.target : null;
	if (!target) return false;
	if (target.closest(KEYS_OF_THEIR_OWN) !== null) return true;
	if (ACTIVATION_KEYS.has(e.key) && target.closest('a[href], button') !== null) return true;
	return e.key === 'Enter' && target.closest('[data-item-card]') !== null;
}

/** The key of the card a key was pressed on, when it was pressed on one (or on something inside one). */
function cardKeyOf(e: KeyboardEvent): string | undefined {
	const card = e.target instanceof Element ? e.target.closest('[data-item-card]') : null;
	return card?.getAttribute('data-item-key') ?? undefined;
}

/** Where a card is on the board: its column and its place in it. */
interface Position {
	item: ItemModel | undefined;
	status: ItemStatus | undefined;
	index: number;
}

const NOWHERE: Position = { item: undefined, status: undefined, index: -1 };

interface KeyboardNavigationOptions {
	/** All items grouped by status */
	itemsByStatus: Partial<Record<ItemStatus, ItemModel[]>>;
	/**
	 * Column traversal order (the board's rendered columns). Selection moves
	 * through these; the 1/2/3 move shortcuts stay ready/in_progress/done —
	 * blocking needs a reason and review needs its sub-status, so there is no
	 * move-to-blocked or move-to-in_review key.
	 */
	columns?: ItemStatus[];
	/** Key of the currently selected item */
	selectedItemKey: string | undefined;
	/** Whether a dialog is open (disables shortcuts) */
	dialogOpen: boolean;
	/** The board's element, whose card the arrows land on takes focus. */
	board: { readonly current: HTMLElement | null };
	/** Callback when selection changes */
	onSelectItem: (item: ItemModel | undefined) => void;
	/** Callback to open an item */
	onOpenItem: (item: ItemModel) => void;
	/** Callback to create a new item */
	onCreateItem: () => void;
	/** Callback to move item to a status */
	onMoveItem: (item: ItemModel, status: Status) => void;
}

/**
 * The board's keys. The arrows move on from the card focus is on, else from the selected
 * card, and move the selection and focus together, so a screen reader says the card they
 * land on, its column scrolls to it, and Enter opens it. Enter (with focus off the cards;
 * a card opens itself) and the move keys act on the selection.
 */
export function useKeyboardNavigation({
	itemsByStatus,
	columns = DEFAULT_COLUMNS,
	selectedItemKey,
	dialogOpen,
	board,
	onSelectItem,
	onOpenItem,
	onCreateItem,
	onMoveItem,
}: KeyboardNavigationOptions): void {
	const locate = useCallback((key: string | undefined): Position => {
		if (!key) return NOWHERE;
		for (const status of columns) {
			const items = itemsByStatus[status] ?? [];
			const index = items.findIndex((e) => e.key === key);
			if (index !== -1) {
				return { item: items[index], status, index };
			}
		}
		return NOWHERE;
	}, [itemsByStatus, columns]);

	const land = useCallback((item: ItemModel | undefined): void => {
		if (!item) return;
		onSelectItem(item);
		board.current?.querySelector<HTMLElement>(`[data-item-card][data-item-key="${item.key}"]`)?.focus();
	}, [board, onSelectItem]);

	// Navigate up/down within a column
	const navigateVertical = useCallback(
		(direction: 'up' | 'down', from: Position, fromKey: string | undefined) => {
			if (!from.status) {
				// A selection that isn't on the board (a child item, open in the drawer)
				// is not something arrow keys can step through — leave it alone rather
				// than treating it as "nothing selected" and jumping to the first card,
				// which would yank the drawer to an unrelated item.
				if (fromKey) return;

				// No selection, select first item in first non-empty column
				for (const s of columns) {
					const items = itemsByStatus[s] ?? [];
					if (items.length > 0) {
						land(items[0]);
						return;
					}
				}
				return;
			}

			const items = itemsByStatus[from.status] ?? [];
			const newIndex = direction === 'up' ? from.index - 1 : from.index + 1;

			if (newIndex >= 0 && newIndex < items.length) {
				land(items[newIndex]);
			}
		},
		[itemsByStatus, columns, land]
	);

	// Navigate left/right between columns
	const navigateHorizontal = useCallback(
		(direction: 'left' | 'right', from: Position, fromKey: string | undefined) => {
			if (!from.status) {
				// Same as navigateVertical: an off-board selection isn't steppable.
				if (fromKey) return;

				// No selection, select first item in first/last non-empty column
				const statuses = direction === 'left' ? [...columns].reverse() : columns;
				for (const s of statuses) {
					const items = itemsByStatus[s] ?? [];
					if (items.length > 0) {
						land(items[0]);
						return;
					}
				}
				return;
			}

			const currentStatusIndex = columns.indexOf(from.status);
			const newStatusIndex =
				direction === 'left' ? currentStatusIndex - 1 : currentStatusIndex + 1;

			if (newStatusIndex >= 0 && newStatusIndex < columns.length) {
				const newStatus = columns[newStatusIndex];
				if (newStatus) {
					const newColumnItems = itemsByStatus[newStatus] ?? [];
					if (newColumnItems.length > 0) {
						// Try to maintain similar position, or go to last item
						const newIndex = Math.min(from.index, newColumnItems.length - 1);
						land(newColumnItems[newIndex]);
					}
				}
			}
		},
		[itemsByStatus, columns, land]
	);

	// Move an item to a status
	const moveToStatus = useCallback(
		(item: ItemModel | undefined, targetStatus: Status) => {
			if (item && item.status !== targetStatus) {
				onMoveItem(item, targetStatus);
			}
		},
		[onMoveItem]
	);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (dialogOpen || handledElsewhere(e)) return;

			// The arrows move on from the card focus is on, else from the selection.
			const focusedKey = cardKeyOf(e);
			const key = focusedKey ?? selectedItemKey;
			const from = locate(key);
			// Enter and the move keys act on the selection alone: a card that merely has focus (a
			// click's, left behind when Escape cleared the selection) is nothing to move.
			const item = focusedKey === undefined || focusedKey === selectedItemKey ? locate(selectedItemKey).item : undefined;

			switch (e.key) {
				case 'ArrowUp':
					e.preventDefault();
					navigateVertical('up', from, key);
					break;

				case 'ArrowDown':
					e.preventDefault();
					navigateVertical('down', from, key);
					break;

				case 'ArrowLeft':
					e.preventDefault();
					navigateHorizontal('left', from, key);
					break;

				case 'ArrowRight':
					e.preventDefault();
					navigateHorizontal('right', from, key);
					break;

				case 'Enter':
					if (item) {
						e.preventDefault();
						onOpenItem(item);
					}
					break;

				case 'Escape':
					e.preventDefault();
					onSelectItem(undefined);
					break;

				case 'n':
				case 'N':
					e.preventDefault();
					onCreateItem();
					break;

				case '1':
					if (item) {
						e.preventDefault();
						moveToStatus(item, 'ready');
					}
					break;

				case '2':
					if (item) {
						e.preventDefault();
						moveToStatus(item, 'in_progress');
					}
					break;

				case '3':
					if (item) {
						e.preventDefault();
						moveToStatus(item, 'done');
					}
					break;
			}
		},
		[
			dialogOpen,
			selectedItemKey,
			locate,
			navigateVertical,
			navigateHorizontal,
			onSelectItem,
			onOpenItem,
			onCreateItem,
			moveToStatus,
		]
	);

	useEffect(() => {
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [handleKeyDown]);
}
