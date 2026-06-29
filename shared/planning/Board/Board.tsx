import { useMemo, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { ItemsCollection, type ItemModel, type Status } from '@specboard/models';
import { Column } from '../Column/Column';
import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';
import { matchesFilters, type PlanningFilters } from '../Planning/filters';
import styles from './Board.module.css';

const COLUMNS: { status: Status; title: string }[] = [
	{ status: 'ready', title: 'Ready' },
	{ status: 'in_progress', title: 'In Progress' },
	{ status: 'done', title: 'Done' },
];

export interface BoardProps {
	/** Shared collection owned by the Planning container. */
	items: ItemsCollection;
	projectId: string;
	/** Active toolbar filters (applied to the cards shown in each column). */
	filters: PlanningFilters;
	selectedItemId?: string;
	highlightedItemId?: string;
	/** Disables keyboard shortcuts while a dialog is open. */
	dialogOpen: boolean;
	onSelectItem: (item: ItemModel | undefined) => void;
	onOpenItem: (item: ItemModel) => void;
	onCreateItem: () => void;
}

/**
 * Kanban board view — one of the two Planning views (see Planning container).
 * Owns the Kanban-only concerns: drag-drop ranking and keyboard navigation.
 */
export function Board({
	items,
	projectId,
	filters,
	selectedItemId,
	highlightedItemId,
	dialogOpen,
	onSelectItem,
	onOpenItem,
	onCreateItem,
}: BoardProps): JSX.Element {
	// Items grouped by status, with the toolbar filters applied to the cards shown.
	const itemsByStatus = useMemo(
		() => ({
			ready: items.byStatus('ready').filter((i) => matchesFilters(i, filters)),
			in_progress: items.byStatus('in_progress').filter((i) => matchesFilters(i, filters)),
			done: items.byStatus('done').filter((i) => matchesFilters(i, filters)),
		}),
		// items.version changes on add/remove/status change so the grouping recomputes
		// even though the collection reference is stable.
		[items, items.version, filters]
	);

	// Wrapper for Column (which only emits ItemModel, never undefined).
	const handleColumnSelectItem = useCallback(
		(item: ItemModel): void => onSelectItem(item),
		[onSelectItem]
	);

	const handleMoveItem = useCallback(
		(item: ItemModel, status: Status): void => {
			item.status = status;
			item.rank = items.byStatus(status).length + 1;
			item.save();
		},
		[items]
	);

	useKeyboardNavigation({
		itemsByStatus,
		selectedItemId,
		dialogOpen,
		onSelectItem,
		onOpenItem,
		onCreateItem,
		onMoveItem: handleMoveItem,
	});

	function handleDragStart(e: DragEvent, item: ItemModel): void {
		e.dataTransfer?.setData('text/plain', item.id);
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
		}
	}

	function handleDragEnd(): void {
		// Drag ended
	}

	function handleDropItem(itemId: string, newStatus: Status, dropIndex: number): void {
		const item = items.find((e) => e.id === itemId);
		if (!item) return;

		// Items in the target column (excluding the dragged item if same column)
		const targetColumnItems = items
			.filter((e) => e.status === newStatus && e.id !== itemId)
			.sort((a, b) => a.rank - b.rank);

		// Calculate new rank based on drop position
		let newRank: number;
		const firstItem = targetColumnItems[0];
		const lastItem = targetColumnItems[targetColumnItems.length - 1];

		if (targetColumnItems.length === 0 || !firstItem || !lastItem) {
			newRank = 1;
		} else if (dropIndex === 0) {
			newRank = firstItem.rank - 1;
		} else if (dropIndex >= targetColumnItems.length) {
			newRank = lastItem.rank + 1;
		} else {
			const prevItem = targetColumnItems[dropIndex - 1];
			const nextItem = targetColumnItems[dropIndex];
			if (prevItem && nextItem) {
				newRank = (prevItem.rank + nextItem.rank) / 2;
			} else {
				newRank = dropIndex + 1;
			}
		}

		item.status = newStatus;
		item.rank = newRank;
		item.save();

		// If ranks get too close (fractional precision issues), normalize the column
		if (shouldNormalizeRanks(targetColumnItems, newRank)) {
			normalizeColumnRanks(newStatus);
		}
	}

	function shouldNormalizeRanks(columnItems: ItemModel[], newRank: number): boolean {
		const allRanks = [...columnItems.map((e) => e.rank), newRank].sort((a, b) => a - b);
		for (let i = 1; i < allRanks.length; i++) {
			const current = allRanks[i];
			const previous = allRanks[i - 1];
			if (current !== undefined && previous !== undefined && Math.abs(current - previous) < 0.001) {
				return true;
			}
		}
		return false;
	}

	function normalizeColumnRanks(status: Status): void {
		const columnItems = items
			.filter((e) => e.status === status)
			.sort((a, b) => a.rank - b.rank);

		columnItems.forEach((item, index) => {
			item.rank = index + 1;
			item.save();
		});
	}

	return (
		<div class={styles.board}>
			{COLUMNS.map(({ status, title }) => (
				<Column
					key={status}
					status={status}
					title={title}
					items={itemsByStatus[status]}
					projectId={projectId}
					selectedItemId={selectedItemId}
					highlightedItemId={highlightedItemId}
					onSelectItem={handleColumnSelectItem}
					onOpenItem={onOpenItem}
					onDropItem={handleDropItem}
					onDragStart={handleDragStart}
					onDragEnd={handleDragEnd}
				/>
			))}
		</div>
	);
}
