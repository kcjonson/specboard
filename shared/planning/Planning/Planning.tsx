import { useState, useMemo, useCallback, useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@specboard/router';
import { navigate } from '@specboard/router';
import { useModel, ItemsCollection, type ItemModel, type Status, type ItemType } from '@specboard/models';
import { Page, SplitButton, Text, Select, type SplitButtonOption } from '@specboard/ui';
import { Board } from '../Board/Board';
import { Table } from '../Table/Table';
import { ItemDrawer } from '../ItemDrawer/ItemDrawer';
import { NewItemDialog } from '../NewItemDialog/NewItemDialog';
import { ViewToggle, type PlanningView } from '../ViewToggle/ViewToggle';
import { CATEGORY_ALL, CATEGORY_OPTIONS, type PlanningFilters } from './filters';
import styles from './Planning.module.css';

/** Duration to highlight a newly created item (ms) */
const HIGHLIGHT_DURATION = 2000;

/** Drawer min width (matches ItemDrawer) and the board's reserved minimum. */
const DRAWER_MIN_WIDTH = 320;
const BOARD_MIN_WIDTH = 360;

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
	const [drawerOpen, setDrawerOpen] = useState(false);
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

	// Keep the active view in sync with the URL on browser back/forward — the
	// router re-renders this same component on popstate without remounting it,
	// so `view` would otherwise drift from `?view=`.
	useEffect(() => {
		const syncView = (): void => setView(readViewFromUrl());
		window.addEventListener('popstate', syncView);
		return () => window.removeEventListener('popstate', syncView);
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

	// Opening an item selects it and reveals the drawer; the drawer always renders
	// the currently selected item, so keyboard navigation updates it live.
	const handleOpenItem = useCallback((item: ItemModel): void => {
		setSelectedItemId(item.id);
		setDrawerOpen(true);
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

	const handleCloseDrawer = useCallback((): void => {
		setDrawerOpen(false);
	}, []);

	const handleDeleteItem = useCallback((item: ItemModel): void => {
		items.remove(item);
		setDrawerOpen(false);
	}, [items]);

	const createOptions: SplitButtonOption[] = useMemo(() => [
		{ label: 'Epic', value: 'epic', icon: 'file' as const, onClick: () => handleOpenNewItemDialog('epic') },
		{ label: 'Task', value: 'task', icon: 'check' as const, onClick: () => handleOpenNewItemDialog('task') },
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

	// The drawer renders whichever item is selected; if that item is removed
	// (e.g. deleted), the lookup returns undefined and the drawer collapses.
	const selectedItem = selectedItemId ? items.find((i) => i.id === selectedItemId) : undefined;

	// Measure the workspace so the drawer can't widen past leaving the board a
	// usable minimum. A callback ref (not useRef + mount effect) is required
	// because the workspace mounts only after the loading/error early-returns
	// below resolve — a one-shot effect would attach before the node exists.
	const [workspaceWidth, setWorkspaceWidth] = useState(0);
	const observerRef = useRef<ResizeObserver | null>(null);
	const workspaceRefCallback = useCallback((node: HTMLDivElement | null): void => {
		observerRef.current?.disconnect();
		if (node && typeof ResizeObserver !== 'undefined') {
			const observer = new ResizeObserver((entries) => {
				const entry = entries[0];
				if (entry) setWorkspaceWidth(entry.contentRect.width);
			});
			observer.observe(node);
			observerRef.current = observer;
		}
	}, []);
	const drawerMaxWidth = workspaceWidth > 0 ? Math.max(DRAWER_MIN_WIDTH, workspaceWidth - BOARD_MIN_WIDTH) : undefined;

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

			<div class={styles.workspace} ref={workspaceRefCallback}>
				<div class={styles.viewArea}>
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
							dialogOpen={isNewItemDialogOpen}
							onSelectItem={handleSelectItem}
							onOpenItem={handleOpenItem}
							onCreateItem={() => handleOpenNewItemDialog('epic')}
						/>
					)}
				</div>

				{drawerOpen && selectedItem && (
					<ItemDrawer
						item={selectedItem}
						projectId={projectId}
						maxWidth={drawerMaxWidth}
						onClose={handleCloseDrawer}
						onDelete={handleDeleteItem}
					/>
				)}
			</div>

			{isNewItemDialogOpen && (
				<NewItemDialog
					createType={createType}
					onClose={handleCloseNewItemDialog}
					onCreate={handleCreateItem}
				/>
			)}
		</Page>
	);
}
