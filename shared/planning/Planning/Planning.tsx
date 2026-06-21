import { useState, useMemo, useCallback, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@specboard/router';
import { navigate } from '@specboard/router';
import { useModel, ItemsCollection, type ItemModel, type Status, type ItemType } from '@specboard/models';
import { Page, SplitButton, Text, Select, type SplitButtonOption } from '@specboard/ui';
import { Board } from '../Board/Board';
import { Table } from '../Table/Table';
import { ItemDialog } from '../ItemDialog/ItemDialog';
import { ViewToggle, type PlanningView } from '../ViewToggle/ViewToggle';
import { CATEGORY_ALL, CATEGORY_OPTIONS, type PlanningFilters } from './filters';
import styles from './Planning.module.css';

/** Duration to highlight a newly created item (ms) */
const HIGHLIGHT_DURATION = 2000;

/** Read the active view from the URL (`?view=table`), defaulting to the board. */
function readViewFromUrl(): PlanningView {
	return new URLSearchParams(window.location.search).get('view') === 'table' ? 'table' : 'board';
}

/**
 * Planning page container — the route entry for `/projects/:projectId/planning`.
 *
 * Owns all state shared between the Board and Table views (the items collection,
 * selection, create/edit dialog, highlight, active view, and filters) and renders
 * the shared toolbar plus whichever view is active. The two views are purely
 * presentational consumers of this state.
 */
export function Planning(props: RouteProps): JSX.Element {
	const projectId = props.params.projectId || 'demo';

	// Collection auto-fetches after projectId is set. Memoized so it survives view
	// toggles (the route/entry is unchanged, only the ?view= param differs).
	const items = useMemo(() => new ItemsCollection({ projectId }), [projectId]);
	useModel(items);

	const [view, setView] = useState<PlanningView>(readViewFromUrl);
	const [filters, setFilters] = useState<PlanningFilters>({ search: '', category: CATEGORY_ALL });

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
			const timer = setTimeout(() => {
				setHighlightedItemId(undefined);
			}, HIGHLIGHT_DURATION);
			return () => clearTimeout(timer);
		}
	}, []);

	const handleChangeView = useCallback((next: PlanningView): void => {
		setView(next);
		// Persist in the URL so the view is shareable and survives reload.
		const params = new URLSearchParams(window.location.search);
		if (next === 'table') {
			params.set('view', 'table');
		} else {
			params.delete('view');
		}
		const search = params.toString();
		navigate(window.location.pathname + (search ? `?${search}` : '') + window.location.hash);
	}, []);

	const handleSelectItem = useCallback((item: ItemModel | undefined): void => {
		setSelectedItemId(item?.id);
	}, []);

	const handleOpenItem = useCallback((item: ItemModel): void => {
		setDialogItem(item);
	}, []);

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

	const handleCloseDialog = useCallback((): void => {
		setDialogItem(null);
	}, []);

	const handleDeleteItem = useCallback((item: ItemModel): void => {
		items.remove(item);
		setDialogItem(null);
	}, [items]);

	const createOptions: SplitButtonOption[] = useMemo(() => [
		{ label: 'Epic', value: 'epic', icon: 'file' as const, onClick: () => handleOpenNewItemDialog('epic') },
		{ label: 'Chore', value: 'chore', icon: 'wrench' as const, onClick: () => handleOpenNewItemDialog('chore') },
		{ label: 'Bug', value: 'bug', icon: 'bug' as const, onClick: () => handleOpenNewItemDialog('bug') },
	], [handleOpenNewItemDialog]);

	const handleSearchInput = useCallback((e: Event): void => {
		const value = (e.target as HTMLInputElement).value;
		setFilters((prev) => ({ ...prev, search: value }));
	}, []);

	const handleCategoryChange = useCallback((e: Event): void => {
		const value = (e.target as HTMLSelectElement).value;
		setFilters((prev) => ({ ...prev, category: value }));
	}, []);

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
				<div class={styles.controls}>
					<ViewToggle view={view} onChange={handleChangeView} />
					<div class={styles.filter}>
						<Text
							type="search"
							value={filters.search}
							placeholder="Search items..."
							onInput={handleSearchInput}
						/>
					</div>
					<div class={styles.filter}>
						<Select
							value={filters.category}
							options={CATEGORY_OPTIONS}
							onChange={handleCategoryChange}
						/>
					</div>
				</div>
				<SplitButton options={createOptions} prefix="+ New" />
			</div>

			{view === 'table' ? (
				<Table
					items={items}
					filters={filters}
					selectedItemId={selectedItemId}
					onSelectItem={handleSelectItem}
					onOpenItem={handleOpenItem}
				/>
			) : (
				<Board
					items={items}
					projectId={projectId}
					filters={filters}
					selectedItemId={selectedItemId}
					highlightedItemId={highlightedItemId}
					dialogOpen={dialogItem !== null || isNewItemDialogOpen}
					onSelectItem={handleSelectItem}
					onOpenItem={handleOpenItem}
					onCreateItem={() => handleOpenNewItemDialog('epic')}
				/>
			)}

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
