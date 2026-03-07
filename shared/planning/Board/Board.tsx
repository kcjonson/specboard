import { useState, useMemo, useCallback, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@specboard/router';
import { useModel, ItemsCollection, type ItemModel, type Status, type ItemType } from '@specboard/models';
import { Page, SplitButton, type SplitButtonOption } from '@specboard/ui';
import { Column } from '../Column/Column';
import { ItemDialog } from '../ItemDialog/ItemDialog';
import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';
import styles from './Board.module.css';

/** Duration to highlight a newly created item (ms) */
const HIGHLIGHT_DURATION = 2000;

const COLUMNS: { status: Status; title: string }[] = [
	{ status: 'ready', title: 'Ready' },
	{ status: 'in_progress', title: 'In Progress' },
	{ status: 'done', title: 'Done' },
];

export function Board(props: RouteProps): JSX.Element {
	const projectId = props.params.projectId || 'demo';

	// Collection auto-fetches after projectId is set
	const items = useMemo(() => new ItemsCollection({ projectId }), [projectId]);
	useModel(items);

	const [selectedItemId, setSelectedItemId] = useState<string | undefined>();
	const [dialogItem, setDialogItem] = useState<ItemModel | null>(null);
	const [isNewItemDialogOpen, setIsNewItemDialogOpen] = useState(false);
	const [createType, setCreateType] = useState<ItemType>('epic');
	const [highlightedItemId, setHighlightedItemId] = useState<string | undefined>();

	// Read highlight param from URL and clear after timeout
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const highlightId = params.get('highlight');
		if (highlightId) {
			setHighlightedItemId(highlightId);
			// Clear only the highlight URL param, preserving other params and hash
			params.delete('highlight');
			const search = params.toString();
			const newUrl =
				window.location.pathname +
				(search ? `?${search}` : '') +
				window.location.hash;
			window.history.replaceState(window.history.state, '', newUrl);
			// Clear highlight after duration
			const timer = setTimeout(() => {
				setHighlightedItemId(undefined);
			}, HIGHLIGHT_DURATION);
			return () => clearTimeout(timer);
		}
	}, []);

	// Memoize items by status for keyboard navigation
	const itemsByStatus = useMemo(
		() => ({
			ready: items.byStatus('ready'),
			in_progress: items.byStatus('in_progress'),
			done: items.byStatus('done'),
		}),
		[items]
	);

	const handleSelectItem = useCallback((item: ItemModel | undefined): void => {
		setSelectedItemId(item?.id);
	}, []);

	// Wrapper for Column component (which only passes ItemModel, not undefined)
	const handleColumnSelectItem = useCallback((item: ItemModel): void => {
		handleSelectItem(item);
	}, [handleSelectItem]);

	const handleOpenItem = useCallback((item: ItemModel): void => {
		setDialogItem(item);
	}, []);

	const handleMoveItem = useCallback(
		(item: ItemModel, status: Status): void => {
			item.status = status;
			item.rank = items.byStatus(status).length + 1;
			item.save();
		},
		[items]
	);

	const handleOpenNewItemDialog = useCallback((type: ItemType): void => {
		setCreateType(type);
		setIsNewItemDialogOpen(true);
	}, []);

	const handleCreateItem = useCallback(
		(data: { title: string; description?: string; status: Status; type?: ItemType }): void => {
			items.add({ ...data, type: data.type || createType, rank: items.length + 1 });
			setIsNewItemDialogOpen(false);
		},
		[items, createType]
	);

	const handleCloseNewItemDialog = useCallback((): void => {
		setIsNewItemDialogOpen(false);
	}, []);

	const createOptions: SplitButtonOption[] = useMemo(() => [
		{ label: 'Epic', value: 'epic', icon: 'file' as const, onClick: () => handleOpenNewItemDialog('epic') },
		{ label: 'Chore', value: 'chore', icon: 'wrench' as const, onClick: () => handleOpenNewItemDialog('chore') },
		{ label: 'Bug', value: 'bug', icon: 'bug' as const, onClick: () => handleOpenNewItemDialog('bug') },
	], [handleOpenNewItemDialog]);

	// Keyboard navigation hook
	useKeyboardNavigation({
		itemsByStatus,
		selectedItemId,
		dialogOpen: dialogItem !== null || isNewItemDialogOpen,
		onSelectItem: handleSelectItem,
		onOpenItem: handleOpenItem,
		onCreateItem: () => handleOpenNewItemDialog('epic'),
		onMoveItem: handleMoveItem,
	});

	function handleCloseDialog(): void {
		setDialogItem(null);
	}

	function handleDeleteItem(item: ItemModel): void {
		items.remove(item);
		setDialogItem(null);
	}

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

		// Get items in the target column (excluding the dragged item if same column)
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
			// Before first item
			newRank = firstItem.rank - 1;
		} else if (dropIndex >= targetColumnItems.length) {
			// After last item
			newRank = lastItem.rank + 1;
		} else {
			// Between two items - use midpoint
			const prevItem = targetColumnItems[dropIndex - 1];
			const nextItem = targetColumnItems[dropIndex];
			if (prevItem && nextItem) {
				newRank = (prevItem.rank + nextItem.rank) / 2;
			} else {
				newRank = dropIndex + 1;
			}
		}

		// Update item
		item.status = newStatus;
		item.rank = newRank;
		item.save();

		// If ranks get too close (fractional precision issues), normalize the column
		if (shouldNormalizeRanks(targetColumnItems, newRank)) {
			normalizeColumnRanks(newStatus);
		}
	}

	function shouldNormalizeRanks(columnItems: ItemModel[], newRank: number): boolean {
		// Check if any ranks are getting too close together
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

	// Loading state
	if (items.$meta.working && items.length === 0) {
		return (
			<Page projectId={projectId} activeTab="Planning">
				<div class={styles.loading}>Loading...</div>
			</Page>
		);
	}

	// Error state from collection's $meta
	if (items.$meta.error) {
		return (
			<Page projectId={projectId} activeTab="Planning">
				<div class={styles.error}>Error: {items.$meta.error.message}</div>
			</Page>
		);
	}

	return (
		<Page projectId={projectId} activeTab="Planning">
			<div class={styles.toolbar}>
				<SplitButton options={createOptions} prefix="+ New" />
			</div>

			<div class={styles.board}>
				{COLUMNS.map(({ status, title }) => (
					<Column
						key={status}
						status={status}
						title={title}
						items={items.byStatus(status)}
						projectId={projectId}
						selectedItemId={selectedItemId}
						highlightedItemId={highlightedItemId}
						onSelectItem={handleColumnSelectItem}
						onOpenItem={handleOpenItem}
						onDropItem={handleDropItem}
						onDragStart={handleDragStart}
						onDragEnd={handleDragEnd}
					/>
				))}
			</div>

			{dialogItem && (
				<ItemDialog
					item={dialogItem}
					projectId={projectId}
					onClose={handleCloseDialog}
					onDelete={handleDeleteItem}
				/>
			)}

			{isNewItemDialogOpen && (
				<ItemDialog
					isNew
					createType={createType}
					onClose={handleCloseNewItemDialog}
					onCreate={handleCreateItem}
				/>
			)}
		</Page>
	);
}
