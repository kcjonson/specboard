import { useState, useMemo, useCallback, useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@specboard/router';
import { formatProjectRef } from '@specboard/core/identifiers';
import { navigate } from '@specboard/router';
import { useModel, useProjectRole, ItemsCollection, ItemModel, type ItemType, writeFailure } from '@specboard/models';
import { Page, SplitButton, Text, Select, Button, Icon, Notice, type SplitButtonOption } from '@specboard/ui';
import { Board, BOARD_PAGE_SIZE } from '../Board/Board';
import { Table, TABLE_PAGE_SIZE } from '../Table/Table';
import { ItemDrawer } from '../ItemDrawer/ItemDrawer';
import { NewItemDialog } from '../NewItemDialog/NewItemDialog';
import type { NewItemData } from '../NewItemForm/NewItemForm';
import { LoadError } from '../LoadError/LoadError';
import { ViewToggle, type PlanningView } from '../ViewToggle/ViewToggle';
import { usePolling } from '../hooks/usePolling';
import { HIGHLIGHT_DURATION } from '../utils/highlight';
import { CATEGORY_OPTIONS, usePlanningFilters } from './filters';
import { VIEW_PREF, writePref } from './prefs';
import { useMapView } from './useMapView';
import { readView, resolveView, useSmallScreen } from './view';
import styles from './Planning.module.css';

/** Drawer min width (matches ItemDrawer) and the board's reserved minimum. */
const DRAWER_MIN_WIDTH = 320;
const BOARD_MIN_WIDTH = 360;

/**
 * Planning page container — the route entry for both `/projects/:owner/:project/planning`
 * and `/projects/:owner/:project/planning/items/:itemKey`.
 *
 * Owns all state shared between the Board and Table views (the items collection,
 * selection, create/edit dialog, highlight, and active view) and renders the shared
 * toolbar plus whichever view is active. The two views are purely presentational
 * consumers of this state.
 *
 * The toolbar's filters are the exception: they stop here. The server filters the
 * collection's windows, so the views never see filter state at all — they render
 * whatever the collection currently holds, which under a search includes child items.
 * The Map takes the settled search text and the type as props and dims by them instead;
 * the collection is left alone while the Map is showing.
 *
 * Which item the drawer shows is not local state — it's the `:itemKey` route param.
 * Opening and closing the drawer are navigations, so Back closes it. The router
 * re-renders this same component (no remount) on those navigations, so the board,
 * filters, and scroll position all survive. The drawer URL is in-app only: a
 * document load of it is redirected to the standalone item page by the frontend
 * service, so this entry only ever mounts with an `:itemKey` via in-app navigation.
 */
export function Planning(props: RouteProps): JSX.Element {
	const projectRef = formatProjectRef(props.params.owner!, props.params.project!);
	// Normalized so a lower-case key from any caller can't miss the collection's
	// canonical `SB-345` and open a duplicate, detached model instead of the live
	// one the board is rendering.
	const openItemKey = props.params.itemKey?.toUpperCase();

	// Whether to offer writes at all. The server refuses them regardless; a write that
	// is refused anyway (the role changed mid-session) lands in writeError below.
	const { canEdit } = useProjectRole(projectRef);
	const [writeError, setWriteError] = useState<string | null>(null);
	const reportWriteError = useCallback((err: unknown, fallback: string): void => {
		setWriteError(writeFailure(err, fallback, projectRef));
	}, [projectRef]);

	// Collection auto-fetches after projectRef is set. Memoized so it survives view
	// toggles (the route/entry is unchanged, only the ?view= param differs). Its
	// per-status windows start at the size of whichever view opens first.
	const items = useMemo(
		() => new ItemsCollection({
			projectRef,
			limit: readView() === 'table' ? TABLE_PAGE_SIZE : BOARD_PAGE_SIZE,
		}),
		[projectRef]
	);
	useModel(items);

	// The view the person asked for. The Map asked for on a small screen shows the Board,
	// without forgetting the request, so widening the window brings the Map back.
	const [requestedView, setRequestedView] = useState<PlanningView>(() => readView());
	const small = useSmallScreen();
	const view = resolveView(requestedView, small);

	// The table shows more per section than the board per column; switching to it
	// widens the windows that had more. Windows never shrink, so board -> table ->
	// board leaves the board showing the wider set.
	useEffect(() => {
		if (view === 'table') void items.ensureLimit(TABLE_PAGE_SIZE);
	}, [view, items]);

	// The toolbar's filter state, and the search text once it has settled. Filtering
	// happens on the server (the views render whatever the collection holds), so the
	// settled text plus the type go to the collection, which reissues its windows.
	// The Map takes the same text and type but filters nothing on the server: it dims, and
	// asks the items list for the matches itself. The board's windows catch up when it returns.
	const {
		filters,
		settledSearch,
		type,
		active: filtersActive,
		onSearchInput: handleSearchInput,
		onCategoryChange: handleCategoryChange,
		clear: handleClearFilters,
	} = usePlanningFilters();
	const onMap = view === 'map';
	useEffect(() => {
		if (onMap) return;
		void items.setFilter({ search: settledSearch, type });
	}, [items, onMap, settledSearch, type]);

	// The board selection — the single source of truth for which card is marked.
	// Seeded from the route so an in-app navigation to an item URL lands with its
	// card selected, and kept in step below whenever the route changes under it.
	const [selectedItemKey, setSelectedItemKey] = useState<string | undefined>(openItemKey);
	const [isNewItemDialogOpen, setIsNewItemDialogOpen] = useState(false);
	const [createType, setCreateType] = useState<ItemType>('epic');

	// Ids currently flashing — driven both by the `?highlight=` param (new items) and
	// by the background poll (items the server changed). Each flash self-clears after
	// HIGHLIGHT_DURATION; timers are tracked so they can be cancelled on unmount.
	const [flashingIds, setFlashingIds] = useState<Set<string>>(() => new Set());
	const flashTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
	const flashItems = useCallback((ids: string[]): void => {
		if (ids.length === 0) return;
		setFlashingIds((prev) => {
			const next = new Set(prev);
			for (const id of ids) next.add(id);
			return next;
		});
		const timer = setTimeout(() => {
			setFlashingIds((prev) => {
				const next = new Set(prev);
				for (const id of ids) next.delete(id);
				return next;
			});
			flashTimers.current = flashTimers.current.filter((t) => t !== timer);
		}, HIGHLIGHT_DURATION);
		flashTimers.current.push(timer);
	}, []);
	useEffect(() => () => flashTimers.current.forEach(clearTimeout), []);

	// Read highlight param from URL and flash that item once
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const highlightId = params.get('highlight');
		if (highlightId) {
			flashItems([highlightId]);
			// Clear only the highlight URL param, preserving other params and hash
			params.delete('highlight');
			const search = params.toString();
			const newUrl =
				window.location.pathname +
				(search ? `?${search}` : '') +
				window.location.hash;
			window.history.replaceState(window.history.state, '', newUrl);
		}
	}, [flashItems]);

	// Changed items flash.
	useEffect(() => {
		const handleItemsChanged = (ids: string[]): void => flashItems(ids);
		items.onItemsChanged(handleItemsChanged);
		return () => items.offItemsChanged(handleItemsChanged);
	}, [items, flashItems]);

	// The collection polls whatever the view (the drawer's top-level item lives in it, on
	// the Map too). Once it is in an error state (429, expired session, network drop) its
	// polls are skipped, and a user-driven fetch that succeeds clears $meta.error so they resume.
	usePolling(() => void items.fetch(), () => items.$meta.error !== null);

	// Keep the active view in sync with the URL on browser back/forward — the
	// router re-renders this same component on popstate without remounting it,
	// so `view` would otherwise drift from `?view=`.
	useEffect(() => {
		const syncView = (): void => setRequestedView(readView());
		window.addEventListener('popstate', syncView);
		return () => window.removeEventListener('popstate', syncView);
	}, []);

	const handleChangeView = useCallback((next: PlanningView): void => {
		setRequestedView(next);
		writePref(VIEW_PREF, next);
		// The view is always written explicitly so a history entry is never ambiguous.
		const params = new URLSearchParams(window.location.search);
		params.set('view', next);
		// A Map anchor means nothing on the other views.
		if (next !== 'map') params.delete('focus');
		const search = params.toString();
		navigate(window.location.pathname + (search ? `?${search}` : '') + window.location.hash);
	}, []);

	// Selection follows the route whenever the route moves on its own — a navigation
	// from elsewhere in the app, or the user hitting Back/Forward across item URLs.
	useEffect(() => {
		if (openItemKey) setSelectedItemKey(openItemKey);
		else openedByPush.current = false;
	}, [openItemKey]);

	/** Board and item URLs, preserving the query string and hash the user is on. */
	const boardUrl = useCallback(
		(): string => `/projects/${projectRef}/planning${window.location.search}${window.location.hash}`,
		[projectRef]
	);
	const itemUrl = useCallback(
		(itemKey: string): string =>
			`/projects/${projectRef}/planning/items/${itemKey}${window.location.search}${window.location.hash}`,
		[projectRef]
	);

	// Moving the selection (arrow keys, clicking a card). With the drawer open it
	// follows live, replacing the history entry rather than pushing one per keystroke.
	// Escape clears the selection and dismisses the drawer with it.
	const handleSelectItem = useCallback((item: ItemModel | undefined): void => {
		setSelectedItemKey(item?.key);
		if (!openItemKey) return;
		navigate(item ? itemUrl(item.key) : boardUrl(), { replace: true });
	}, [openItemKey, itemUrl, boardUrl]);

	// History model for the drawer, applied by every path that opens or closes it:
	//   - opening from the board is a new place        -> push, so Back closes it
	//   - moving between items while already open      -> replace, so browsing ten
	//     items doesn't leave ten entries to Back through
	//   - closing                                      -> undo our own push (below)
	// Card clicks call onSelect *then* onOpen, so without the replace-when-open rule
	// the select's navigation would land first and silently swallow the open's push.
	const openedByPush = useRef(false);
	const handleOpenItemByKey = useCallback((itemKey: string): void => {
		setSelectedItemKey(itemKey);
		if (openItemKey) {
			navigate(itemUrl(itemKey), { replace: true });
		} else {
			openedByPush.current = true;
			navigate(itemUrl(itemKey));
		}
	}, [itemUrl, openItemKey]);

	const handleOpenItem = useCallback((item: ItemModel): void => {
		handleOpenItemByKey(item.key);
	}, [handleOpenItemByKey]);

	const handleOpenNewItemDialog = useCallback((type: ItemType): void => {
		setCreateType(type);
		setIsNewItemDialogOpen(true);
	}, []);

	// No rank: the server appends (project-wide max + 1). The collection's length is
	// only what's loaded, so a rank derived from it would land mid-column. The dialog
	// closes either way, as ChildrenSection's does: it is a native modal in the top
	// layer, and a refusal shown behind it would go unseen.
	const handleCreateItem = useCallback(
		async (data: NewItemData): Promise<void> => {
			setIsNewItemDialogOpen(false);
			setWriteError(null);
			try {
				await items.add({ ...data, type: data.type || createType });
			} catch (err) {
				reportWriteError(err, `Could not create that ${data.type || createType}.`);
			}
		},
		[items, createType, reportWriteError]
	);

	const handleCloseNewItemDialog = useCallback((): void => {
		setIsNewItemDialogOpen(false);
	}, []);

	// Closing undoes our own push where there is one, which leaves the history exactly
	// as it was before the drawer opened. Replacing instead would strand a duplicate
	// board entry, making the next Back appear to do nothing; pushing would make Back
	// reopen the drawer. When the drawer was opened by a navigation from elsewhere in
	// the app, or restored by Back/Forward, there is nothing of ours to pop, so replace.
	const handleCloseDrawer = useCallback((): void => {
		if (openedByPush.current) {
			openedByPush.current = false;
			window.history.back();
			return;
		}
		navigate(boardUrl(), { replace: true });
	}, [boardUrl]);

	// The board mounts useKeyboardNavigation, whose Escape clears the selection and
	// dismisses the drawer with it. The table mounts no keyboard hook, so Escape is
	// wired here for that view; the drawer's own handler stops propagation when
	// focus is inside it, so this only fires with focus out on the table.
	useEffect(() => {
		if (view !== 'table') return;
		const onKeyDown = (e: KeyboardEvent): void => {
			if (e.key !== 'Escape' || !openItemKey || isNewItemDialogOpen) return;
			const target = e.target as HTMLElement;
			if (
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.tagName === 'SELECT' ||
				target.isContentEditable
			) return;
			setSelectedItemKey(undefined);
			handleCloseDrawer();
		};
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [view, openItemKey, isNewItemDialogOpen, handleCloseDrawer]);

	const handleDeleteItem = useCallback(async (item: ItemModel): Promise<void> => {
		setWriteError(null);
		const inCollection = items.find((i) => i.key === item.key);
		try {
			if (inCollection) {
				await items.remove(inCollection);
			} else {
				// A child opened standalone isn't in the top-level collection — delete it directly.
				await item.delete();
			}
		} catch (err) {
			reportWriteError(err, 'Could not delete that item.');
			return;
		}
		setSelectedItemKey(undefined);
		navigate(boardUrl(), { replace: true });
	}, [items, boardUrl, reportWriteError]);

	const createOptions: SplitButtonOption[] = useMemo(() => [
		{ label: 'Epic', value: 'epic', icon: 'file' as const, onClick: () => handleOpenNewItemDialog('epic') },
		{ label: 'Task', value: 'task', icon: 'checkbox-unchecked' as const, onClick: () => handleOpenNewItemDialog('task') },
		{ label: 'Bug', value: 'bug', icon: 'bug' as const, onClick: () => handleOpenNewItemDialog('bug') },
	], [handleOpenNewItemDialog]);

	// Rendered twice (inline desktop / popover mobile); both copies are controlled
	// by the same `filters` state so they can never disagree. autoFocus only in the
	// popover so the keyboard opens with it.
	const renderFilters = (inPopover: boolean): JSX.Element => (
		<>
			<div class={styles.filter}>
				<Text
					type="search"
					value={filters.search}
					placeholder="Search items..."
					onInput={handleSearchInput}
					autoFocus={inPopover}
				/>
			</div>
			<div class={styles.filter}>
				<Select
					value={filters.category}
					options={CATEGORY_OPTIONS}
					onChange={handleCategoryChange}
				/>
			</div>
		</>
	);

	// The drawer renders the item named by the route. A top-level item uses the live
	// collection model, so edits reflect on the board immediately. Anything else — a
	// child, or an item the collection has dropped — gets a standalone model that
	// fetches its own detail, and the drawer stays inert until that fetch lands.
	//
	// `items` is a stable reference whose *contents* change, so the collection lookup
	// has to run every render (it is a cheap array scan) rather than inside the memo:
	// memoizing it meant that when a poll dropped the open item, the cached `undefined`
	// stood and the drawer silently vanished mid-edit. Waiting for the first fetch also
	// avoids building a standalone model for an item that is merely still loading.
	const collectionItem = openItemKey ? items.find((i) => i.key === openItemKey) : undefined;
	const standaloneKey = openItemKey && !collectionItem && items.$meta.lastFetched !== null
		? openItemKey
		: undefined;
	const standaloneItem = useMemo(
		() => (standaloneKey ? new ItemModel({ key: standaloneKey, projectRef }) : undefined),
		[standaloneKey, projectRef]
	);
	const openItem = collectionItem ?? standaloneItem;

	// Measure the workspace so the drawer can't widen past leaving the board a
	// usable minimum. A callback ref keeps the observer bound to whichever node
	// is current rather than to the one present at mount.
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
	// The Map has the drawer overlay it rather than narrow it, and needs to know how much it covers.
	const [drawerWidth, setDrawerWidth] = useState(0);
	const drawerMaxWidth = workspaceWidth > 0 ? Math.max(DRAWER_MIN_WIDTH, workspaceWidth - BOARD_MIN_WIDTH) : undefined;

	// Loading and load failures render where the board goes, so the toolbar stays
	// put. While the page is in error every automatic fetch is suppressed, so
	// recovery is always something the user does: Retry, a filter change, or
	// signing back in. Replacing the page would unmount the search box and give a
	// signed-out user nothing to act on.
	const loadError = items.$meta.error;
	const handleRetry = useCallback((): void => {
		void items.fetch({ force: true });
	}, [items]);

	// The Map is a lazy chunk with a read of its own, so it sits outside the collection's
	// loading and error states: a failed board fetch says nothing about the Map.
	const { MapView, error: mapError, retry: retryMap } = useMapView(view === 'map');

	const renderViewArea = (): JSX.Element => {
		if (view === 'map') {
			if (mapError) return <LoadError error={mapError} onRetry={retryMap} />;
			if (!MapView) return <div class={styles.loading}>Loading...</div>;
			return (
				<MapView
					scope={{ projectRef }}
					openItemKey={openItemKey}
					covered={openItem ? drawerWidth : 0}
					onOpenItem={handleOpenItemByKey}
					onCloseItem={handleCloseDrawer}
					search={settledSearch}
					type={type ?? null}
					onClear={handleClearFilters}
				/>
			);
		}
		if (loadError) return <LoadError error={loadError} onRetry={handleRetry} />;
		// First load only: a later fetch that returns nothing (an empty search, a poll
		// after one) keeps the empty columns rather than swapping in a spinner.
		if (items.$meta.working && items.$meta.lastFetched === null) {
			return <div class={styles.loading}>Loading...</div>;
		}
		return view === 'table' ? (
			<Table
				items={items}
				selectedItemKey={selectedItemKey}
				flashingIds={flashingIds}
				onSelectItem={handleSelectItem}
				onOpenItem={handleOpenItem}
				onOpenChild={handleOpenItemByKey}
			/>
		) : (
			<Board
				items={items}
				projectRef={projectRef}
				selectedItemKey={selectedItemKey}
				flashingIds={flashingIds}
				dialogOpen={isNewItemDialogOpen}
				canEdit={canEdit}
				onSelectItem={handleSelectItem}
				onOpenItem={handleOpenItem}
				onCreateItem={() => handleOpenNewItemDialog('epic')}
				onWriteError={reportWriteError}
			/>
		);
	};

	return (
		<Page projectRef={projectRef} activeTab="Planning">
			<div class={styles.toolbar}>
				<div class={styles.controls}>
					<ViewToggle view={view} onChange={handleChangeView} mapAvailable={!small} />
					<div class={styles.filters}>{renderFilters(false)}</div>
				</div>
				<div class={styles.toolbarEnd}>
					{canEdit && <SplitButton options={createOptions} prefix="+ New" />}
					<button
						type="button"
						class={`secondary mobile-only ${styles.searchButton} ${filtersActive ? styles.searchActive : ''}`}
						popovertarget="planning-search"
						aria-label="Search and filter"
					>
						<Icon name="search" />
					</button>
					<div popover="auto" id="planning-search" class={styles.searchPopover}>
						{renderFilters(true)}
						{filtersActive && (
							<div class={styles.searchClearRow}>
								<Button class="text" onClick={handleClearFilters}>Clear filters</Button>
							</div>
						)}
					</div>
				</div>
			</div>

			{writeError && (
				<div class={styles.writeError} role="alert">
					<Notice variant="error">
						<span class={styles.writeErrorText}>{writeError}</span>
						<Button class="text size-sm" onClick={() => setWriteError(null)}>Dismiss</Button>
					</Notice>
				</div>
			)}

			<div class={styles.workspace} ref={workspaceRefCallback}>
				<div class={styles.viewArea}>{renderViewArea()}</div>

				{openItem && (
					<div class={view === 'map' ? styles.drawerOverlay : styles.drawerSlot}>
						<ItemDrawer
							item={openItem}
							listed={collectionItem !== undefined}
							projectRef={projectRef}
							canEdit={canEdit}
							maxWidth={drawerMaxWidth}
							onClose={handleCloseDrawer}
							onResize={setDrawerWidth}
							onDelete={(item) => void handleDeleteItem(item)}
							onOpenItem={handleOpenItemByKey}
						/>
					</div>
				)}
			</div>

			{isNewItemDialogOpen && canEdit && (
				<NewItemDialog
					projectRef={projectRef}
					createType={createType}
					onClose={handleCloseNewItemDialog}
					onCreate={(data) => void handleCreateItem(data)}
				/>
			)}
		</Page>
	);
}
