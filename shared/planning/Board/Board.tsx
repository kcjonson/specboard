import { useMemo, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { ItemsCollection, type ItemModel, type Status, type ItemStatus } from '@specboard/models';
import { Column } from '../Column/Column';
import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';
import { matchesFilters, type PlanningFilters } from '../Planning/filters';
import styles from './Board.module.css';

export interface BoardProps {
	/** Shared collection owned by the Planning container. */
	items: ItemsCollection;
	projectSlug: string;
	/** Active toolbar filters (applied to the cards shown in each column). */
	filters: PlanningFilters;
	selectedItemKey?: string;
	/** Item keys to briefly flash (newly created, or changed by a background refresh). */
	flashingIds: Set<string>;
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
	projectSlug,
	filters,
	selectedItemKey,
	flashingIds,
	dialogOpen,
	onSelectItem,
	onOpenItem,
	onCreateItem,
}: BoardProps): JSX.Element {
	// Items grouped by status, with the toolbar filters applied to the cards shown.
	// 'blocked' holds the status-level manual holds (row-blocked items stay in
	// their real column with a chip); its column renders only when non-empty.
	const itemsByStatus = useMemo(
		() => ({
			ready: items.byStatus('ready').filter((i) => matchesFilters(i, filters)),
			in_progress: items.byStatus('in_progress').filter((i) => matchesFilters(i, filters)),
			blocked: items.byStatus('blocked').filter((i) => matchesFilters(i, filters)),
			done: items.byStatus('done').filter((i) => matchesFilters(i, filters)),
		}),
		// items.version changes on add/remove/status change so the grouping recomputes
		// even though the collection reference is stable.
		[items, items.version, filters]
	);
	const blockedItems = itemsByStatus.blocked;

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
		// Traversal follows the rendered column order, Blocked included when shown.
		columns: blockedItems.length > 0
			? ['ready', 'in_progress', 'blocked', 'done']
			: ['ready', 'in_progress', 'done'],
		selectedItemKey,
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

	// The Blocked column appears after In Progress, only while something is held
	// there. Not a drop target: blocking needs a reason (use the drawer). Built as
	// a flat list so every column is keyed at the top level of the map.
	const columns: { status: ItemStatus; title: string; items: ItemModel[]; droppable: boolean }[] = [
		{ status: 'ready', title: 'Ready', items: itemsByStatus.ready, droppable: true },
		{ status: 'in_progress', title: 'In Progress', items: itemsByStatus.in_progress, droppable: true },
		...(blockedItems.length > 0
			? [{ status: 'blocked' as const, title: 'Blocked', items: blockedItems, droppable: false }]
			: []),
		{ status: 'done', title: 'Done', items: itemsByStatus.done, droppable: true },
	];

	return (
		<div class={styles.board}>
			{columns.map(({ status, title, items: columnItems, droppable }) => (
				<Column
					key={status}
					status={status}
					title={title}
					items={columnItems}
					projectSlug={projectSlug}
					selectedItemKey={selectedItemKey}
					flashingIds={flashingIds}
					droppable={droppable}
					onSelectItem={handleColumnSelectItem}
					onOpenItem={onOpenItem}
					onDropItem={droppable ? handleDropItem : undefined}
					onDragStart={handleDragStart}
					onDragEnd={handleDragEnd}
				/>
			))}
		</div>
	);
}
