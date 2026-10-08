import { useMemo, useCallback, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { ItemModel, ItemsCollection, ItemsSource, Status, ItemStatus } from '@specboard/models';
import { Column, type ColumnMore } from '../Column/Column';
import type { ProjectLabel } from '../ProjectChip/ProjectChip';
import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';
import styles from './Board.module.css';

function noop(): void {}

/** Cards a column starts with, and how many each "show more" adds. */
export const BOARD_PAGE_SIZE = 100;

interface BoardCommonProps {
	selectedItemKey?: string;
	/** Item keys to briefly flash (newly created, or changed by a background refresh). */
	flashingIds?: Set<string>;
	/** Disables keyboard shortcuts while a dialog is open. */
	dialogOpen?: boolean;
	/**
	 * The projects the cards come from, by ref, for a board that mixes them: every card then
	 * says which it's from. A single project's board has no such label.
	 */
	projects?: ReadonlyMap<string, ProjectLabel>;
	onSelectItem: (item: ItemModel | undefined) => void;
	onOpenItem: (item: ItemModel) => void;
}

/**
 * One project's board. A move ranks a card among its own project's cards, so a board that
 * takes moves reads that project's collection.
 */
interface ProjectBoardProps extends BoardCommonProps {
	/** Shared collection owned by the Planning container. */
	items: ItemsCollection;
	/** Whether the caller may change the board (useProjectRole). Off: no drag-and-drop, no move or create keys. */
	canEdit: boolean;
	onCreateItem: () => void;
	/** A move the server refused. The card is already back where it was. */
	onWriteError: (err: unknown, fallback: string) => void;
}

/** A board that only reads, over several projects' items merged (the multi-project view). */
interface ReadOnlyBoardProps extends BoardCommonProps {
	items: ItemsSource;
	canEdit: false;
}

export type BoardProps = ProjectBoardProps | ReadOnlyBoardProps;

/** Moving cards on one project's board, by the move keys and by drag-and-drop. */
interface CardMoves {
	move: (item: ItemModel, status: Status) => void;
	drop: (itemId: string, status: Status, dropIndex: number) => void;
}

function cardMoves(items: ItemsCollection, onWriteError: (err: unknown, fallback: string) => void): CardMoves {
	// A rank that puts `item` after every card in the column. Ranks are sparse (a new
	// item takes the project-wide max + 1), so this is the last loaded rank + 1, not
	// the column length; and when the column has cards past its window it must be at
	// least the first unloaded rank, or the next poll would read the card as dropped.
	const endRank = (item: ItemModel, status: ItemStatus): number => {
		const last = items.byStatus(status).filter((e) => e !== item && !e.parentKey).at(-1);
		const afterLoaded = last ? last.rank + 1 : 1;
		const unloaded = items.firstUnloadedRank(status);
		return unloaded === undefined ? afterLoaded : Math.max(afterLoaded, unloaded);
	};

	// Moves are optimistic: the card goes where it was put, and goes back if the server
	// refuses, with the refusal reported.
	const saveMove = (item: ItemModel, previous: { status: ItemStatus; rank: number }): void => {
		item.save().catch((err: unknown) => {
			item.status = previous.status;
			item.rank = previous.rank;
			onWriteError(err, `Could not move ${item.key}.`);
		});
	};

	const shouldNormalizeRanks = (columnItems: ItemModel[], newRank: number): boolean => {
		const allRanks = [...columnItems.map((e) => e.rank), newRank].sort((a, b) => a - b);
		for (let i = 1; i < allRanks.length; i++) {
			const current = allRanks[i];
			const previous = allRanks[i - 1];
			if (current !== undefined && previous !== undefined && Math.abs(current - previous) < 0.001) {
				return true;
			}
		}
		return false;
	};

	const normalizeColumnRanks = (status: Status): void => {
		// Top-level cards only: a child's rank numbers it against its parent's other
		// children, so renumbering it 1..n against this column would rewrite the order
		// of an unrelated parent's list.
		const columnItems = items
			.filter((e) => e.status === status && !e.parentKey)
			.sort((a, b) => a.rank - b.rank);

		columnItems.forEach((item, index) => {
			const previous = { status: item.status, rank: item.rank };
			item.rank = index + 1;
			saveMove(item, previous);
		});
	};

	return {
		move: (item, status) => {
			// Same reason drag is off for it (see Column): a child's rank belongs to its
			// parent's sibling group, and a column rank would shove it to the end of that.
			if (item.parentKey) return;
			const previous = { status: item.status, rank: item.rank };
			item.rank = endRank(item, status);
			item.status = status;
			saveMove(item, previous);
		},
		drop: (itemId, newStatus, dropIndex) => {
			const item = items.find((e) => e.id === itemId);
			// A child row (a search match) has no top-level position to be dropped into;
			// its card isn't draggable, so this only guards a drop from elsewhere.
			if (!item || item.parentKey) return;

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

			const previous = { status: item.status, rank: item.rank };
			item.status = newStatus;
			item.rank = newRank;
			saveMove(item, previous);

			// If ranks get too close (fractional precision issues), normalize the column.
			// Not while it has cards past its window: renumbering only the loaded ones
			// could put them behind ranks the board can't see.
			if (!items.hasMore(newStatus) && shouldNormalizeRanks(siblings(rendered), newRank)) {
				normalizeColumnRanks(newStatus);
			}
		},
	};
}

/**
 * Kanban board view, one of the planning views (see the Planning container, and the
 * multi-project view, which shows several projects' items on one read-only board).
 * Owns the Kanban-only concerns: drag-drop ranking and keyboard navigation.
 */
export function Board(props: BoardProps): JSX.Element {
	const { items, selectedItemKey, flashingIds, dialogOpen = false, projects, onSelectItem, onOpenItem } = props;

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

	// Only one project's collection, for someone who may change it, takes moves.
	const editable = props.canEdit ? props.items : null;
	const onWriteError = props.canEdit ? props.onWriteError : null;
	const moves = useMemo(
		() => (editable && onWriteError ? cardMoves(editable, onWriteError) : null),
		[editable, onWriteError]
	);

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
		onCreateItem: props.canEdit ? props.onCreateItem : noop,
		onMoveItem: moves?.move ?? noop,
	});

	function handleDragStart(e: DragEvent, item: ItemModel): void {
		e.dataTransfer?.setData('text/plain', item.id);
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
		}
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
					projects={projects}
					selectedItemKey={selectedItemKey}
					flashingIds={flashingIds}
					droppable={droppable && moves !== null}
					draggable={moves !== null}
					onSelectItem={handleColumnSelectItem}
					onOpenItem={onOpenItem}
					onDropItem={droppable ? moves?.drop : undefined}
					onDragStart={handleDragStart}
				/>
			))}
		</div>
	);
}
