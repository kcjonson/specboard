import { useEffect, useCallback } from 'preact/hooks';
import type { ItemModel, Status } from '@specboard/models';

const STATUSES: Status[] = ['ready', 'in_progress', 'done'];

interface KeyboardNavigationOptions {
	/** All items grouped by status */
	itemsByStatus: Record<Status, ItemModel[]>;
	/** Currently selected item ID */
	selectedItemId: string | undefined;
	/** Whether a dialog is open (disables shortcuts) */
	dialogOpen: boolean;
	/** Callback when selection changes */
	onSelectItem: (item: ItemModel | undefined) => void;
	/** Callback to open an item */
	onOpenItem: (item: ItemModel) => void;
	/** Callback to create a new item */
	onCreateItem: () => void;
	/** Callback to move item to a status */
	onMoveItem: (item: ItemModel, status: Status) => void;
}

export function useKeyboardNavigation({
	itemsByStatus,
	selectedItemId,
	dialogOpen,
	onSelectItem,
	onOpenItem,
	onCreateItem,
	onMoveItem,
}: KeyboardNavigationOptions): void {
	// Find the selected item and its position
	const findSelectedItem = useCallback((): {
		item: ItemModel | undefined;
		status: Status | undefined;
		index: number;
	} => {
		if (!selectedItemId) {
			return { item: undefined, status: undefined, index: -1 };
		}

		for (const status of STATUSES) {
			const items = itemsByStatus[status];
			const index = items.findIndex((e) => e.id === selectedItemId);
			if (index !== -1) {
				return { item: items[index], status, index };
			}
		}

		return { item: undefined, status: undefined, index: -1 };
	}, [selectedItemId, itemsByStatus]);

	// Navigate up/down within a column
	const navigateVertical = useCallback(
		(direction: 'up' | 'down') => {
			const { status, index } = findSelectedItem();

			if (!status) {
				// No selection, select first item in first non-empty column
				for (const s of STATUSES) {
					const items = itemsByStatus[s];
					if (items.length > 0) {
						onSelectItem(items[0]);
						return;
					}
				}
				return;
			}

			const items = itemsByStatus[status];
			const newIndex = direction === 'up' ? index - 1 : index + 1;

			if (newIndex >= 0 && newIndex < items.length) {
				onSelectItem(items[newIndex]);
			}
		},
		[findSelectedItem, itemsByStatus, onSelectItem]
	);

	// Navigate left/right between columns
	const navigateHorizontal = useCallback(
		(direction: 'left' | 'right') => {
			const { status, index } = findSelectedItem();

			if (!status) {
				// No selection, select first item in first/last non-empty column
				const statuses = direction === 'left' ? [...STATUSES].reverse() : STATUSES;
				for (const s of statuses) {
					const items = itemsByStatus[s];
					if (items.length > 0) {
						onSelectItem(items[0]);
						return;
					}
				}
				return;
			}

			const currentStatusIndex = STATUSES.indexOf(status);
			const newStatusIndex =
				direction === 'left' ? currentStatusIndex - 1 : currentStatusIndex + 1;

			if (newStatusIndex >= 0 && newStatusIndex < STATUSES.length) {
				const newStatus = STATUSES[newStatusIndex];
				if (newStatus) {
					const newColumnItems = itemsByStatus[newStatus];
					if (newColumnItems.length > 0) {
						// Try to maintain similar position, or go to last item
						const newIndex = Math.min(index, newColumnItems.length - 1);
						onSelectItem(newColumnItems[newIndex]);
					}
				}
			}
		},
		[findSelectedItem, itemsByStatus, onSelectItem]
	);

	// Move selected item to a status
	const moveToStatus = useCallback(
		(targetStatus: Status) => {
			const { item } = findSelectedItem();
			if (item && item.status !== targetStatus) {
				onMoveItem(item, targetStatus);
			}
		},
		[findSelectedItem, onMoveItem]
	);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			// Don't handle if dialog is open or if typing in an input
			if (dialogOpen) return;

			const target = e.target as HTMLElement;
			const isInput =
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable;

			if (isInput) return;

			const { item } = findSelectedItem();

			switch (e.key) {
				case 'ArrowUp':
					e.preventDefault();
					navigateVertical('up');
					break;

				case 'ArrowDown':
					e.preventDefault();
					navigateVertical('down');
					break;

				case 'ArrowLeft':
					e.preventDefault();
					navigateHorizontal('left');
					break;

				case 'ArrowRight':
					e.preventDefault();
					navigateHorizontal('right');
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
						moveToStatus('ready');
					}
					break;

				case '2':
					if (item) {
						e.preventDefault();
						moveToStatus('in_progress');
					}
					break;

				case '3':
					if (item) {
						e.preventDefault();
						moveToStatus('done');
					}
					break;
			}
		},
		[
			dialogOpen,
			findSelectedItem,
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
