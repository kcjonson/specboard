import { useMemo, useCallback, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { ItemsCollection, type ItemModel, type Status, type ItemStatus } from '@specboard/models';
import { Column, type ColumnMore } from '../Column/Column';
import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';
import styles from './Board.module.css';

/** Cards a column starts with, and how many each "show more" adds. */
export const BOARD_PAGE_SIZE = 100;

export interface BoardProps {
	/** Shared collection owned by the Planning container. */
	items: ItemsCollection;
	projectSlug: string;
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
	selectedItemKey,
	flashingIds,
	dialogOpen,
	onSelectItem,
	onOpenItem,
	onCreateItem,
}: BoardProps): JSX.Element {
	// Items grouped by status. The collection holds exactly what the current query
	// matched, so there is nothing to filter here; a search also matches child items,
	// and those sit in the column of their own status like any other card.
	// 'blocked' holds the status-level manual holds (row-blocked items stay in
	// their real column with a chip); it and 'in_review' render only when non-empty.
	const itemsByStatus = useMemo(
		() => ({
			ready: items.byStatus('ready'),
			in_progress: items.byStatus('in_progress'),
			blocked: items.byStatus('blocked'),
			in_review: items.byStatus('in_review'),
			done: items.byStatus('done'),
		}),
		// items.version changes on add/remove/status change so the grouping recomputes
		// even though the collection reference is stable.
		[items, items.version]
	);
	const blockedItems = itemsByStatus.blocked;
	const inReviewItems = itemsByStatus.in_review;

	// Which columns are fetching their next page; each ghost card shows its own
	// loading state, so two clicks in flight at once don't clear each other.
	const [loadingMore, setLoadingMore] = useState<ReadonlySet<ItemStatus>>(() => new Set());
	const handleLoadMore = useCallback(async (status: ItemStatus): Promise<void> => {
		setLoadingMore((prev) => new Set(prev).add(status));
		try {
			await items.loadMore(status, BOARD_PAGE_SIZE);
		} finally {
			setLoadingMore((prev) => {
				const next = new Set(prev);
				next.delete(status);
				return next;
			});
		}
	}, [items]);

	// The header count is the server total for the status — already narrowed by
	// whatever filter is active, since the server counts what it matched.
	const columnMore = (status: ItemStatus): ColumnMore | undefined => {
		if (!items.hasMore(status)) return undefined;
		return {
			loaded: items.loadedFor(status),
			total: items.totalFor(status),
			loading: loadingMore.has(status),
			onLoadMore: () => void handleLoadMore(status),
		};
	};

	// Wrapper for Column (which only emits ItemModel, never undefined).
	const handleColumnSelectItem = useCallback(
		(item: ItemModel): void => onSelectItem(item),
		[onSelectItem]
	);

	// A rank that puts `item` after every card in the column. Ranks are sparse (a new
	// item takes the project-wide max + 1), so this is the last loaded rank + 1, not
	// the column length; and when the column has cards past its window it must be at
	// least the first unloaded rank, or the next poll would read the card as dropped.
	const endRank = useCallback((item: ItemModel, status: ItemStatus): number => {
		const last = items.byStatus(status).filter((e) => e !== item && !e.parentKey).at(-1);
		const afterLoaded = last ? last.rank + 1 : 1;
		const unloaded = items.firstUnloadedRank(status);
		return unloaded === undefined ? afterLoaded : Math.max(afterLoaded, unloaded);
	}, [items]);

	const handleMoveItem = useCallback(
		(item: ItemModel, status: Status): void => {
			// Same reason drag is off for it (see below): a child's rank belongs to its
			// parent's sibling group, and a column rank would shove it to the end of that.
			if (item.parentKey) return;
			item.rank = endRank(item, status);
			item.status = status;
			item.save();
		},
		[endRank]
	);

	// Blocked and In Review sit between In Progress and Done, each only while
	// something is held there — the same rule and the same order the table view
	// groups its sections by. Neither is a drop target: an item reaches those
	// statuses through the drawer, where blocking takes a reason and review takes
	// the sub-status that goes with it, and a drop writes status alone. Built as a
	// flat list so every column is keyed at the top level of the map, and so
	// keyboard traversal below reads the columns that actually render.
	const columns: { status: ItemStatus; title: string; items: ItemModel[]; droppable: boolean }[] = [
		{ status: 'ready', title: 'Ready', items: itemsByStatus.ready, droppable: true },
		{ status: 'in_progress', title: 'In Progress', items: itemsByStatus.in_progress, droppable: true },
		...(blockedItems.length > 0
			? [{ status: 'blocked' as const, title: 'Blocked', items: blockedItems, droppable: false }]
			: []),
		...(inReviewItems.length > 0
			? [{ status: 'in_review' as const, title: 'In Review', items: inReviewItems, droppable: false }]
			: []),
		{ status: 'done', title: 'Done', items: itemsByStatus.done, droppable: true },
	];

	useKeyboardNavigation({
		itemsByStatus,
		columns: columns.map((column) => column.status),
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
		// A child row (a search match) has no top-level position to be dropped into;
		// its card isn't draggable, so this only guards a drop from elsewhere.
		if (item.parentKey) return;

		// The column exactly as the drop index was measured against — Column counts
		// rendered cards, so the dragged card and any child rows are in that index
		// too. The ranks around the drop are the neighbouring siblings: children rank
		// among their own parent's children, so they are no reference point here.
		const rendered = items.byStatus(newStatus);
		const siblings = (rows: ItemModel[]): ItemModel[] =>
			rows.filter((e) => !e.parentKey && e.id !== itemId);
		const before = siblings(rendered.slice(0, dropIndex)).at(-1);
		const after = siblings(rendered.slice(dropIndex))[0];

		let newRank: number;
		if (before && after) {
			newRank = (before.rank + after.rank) / 2;
		} else if (after) {
			newRank = after.rank - 1;
		} else if (before) {
			newRank = endRank(item, newStatus);
		} else {
			newRank = 1;
		}

		item.status = newStatus;
		item.rank = newRank;
		item.save();

		// If ranks get too close (fractional precision issues), normalize the column.
		// Not while it has cards past its window: renumbering only the loaded ones
		// could put them behind ranks the board can't see.
		if (!items.hasMore(newStatus) && shouldNormalizeRanks(siblings(rendered), newRank)) {
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
		// Top-level cards only: a child's rank numbers it against its parent's other
		// children, so renumbering it 1..n against this column would rewrite the order
		// of an unrelated parent's list.
		const columnItems = items
			.filter((e) => e.status === status && !e.parentKey)
			.sort((a, b) => a.rank - b.rank);

		columnItems.forEach((item, index) => {
			item.rank = index + 1;
			item.save();
		});
	}

	return (
		<div class={styles.board}>
			{columns.map(({ status, title, items: columnItems, droppable }) => (
				<Column
					key={status}
					status={status}
					title={title}
					items={columnItems}
					count={items.totalFor(status)}
					more={columnMore(status)}
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
