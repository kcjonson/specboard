import { useState, useMemo, useCallback, useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@specboard/router';
import { navigate } from '@specboard/router';
import { useModel, ItemsCollection, ItemModel, type Status, type ItemType } from '@specboard/models';
import { Page, SplitButton, Text, Select, Button, Icon, type SplitButtonOption, type SelectOption } from '@specboard/ui';
import { Board, BOARD_PAGE_SIZE } from '../Board/Board';
import { Table, TABLE_PAGE_SIZE } from '../Table/Table';
import { ItemDrawer, MissingItemDrawer } from '../ItemDrawer/ItemDrawer';
import { NewItemDialog } from '../NewItemDialog/NewItemDialog';
import { ViewToggle, type PlanningView } from '../ViewToggle/ViewToggle';
import { VIEW_PREF, readPref, writePref } from './prefs';
import styles from './Planning.module.css';

/** Duration to flash an item that was just created or changed by a refresh (ms) */
const HIGHLIGHT_DURATION = 2000;

/** How often to poll the server for item changes while the page is visible (ms) */
const POLL_INTERVAL = 10000;

/**
 * How long the search box sits still before its text becomes a new query. Each
 * change costs one request per status window, so keystrokes are collapsed; the
 * type Select is a single deliberate choice and applies immediately.
 */
const SEARCH_DEBOUNCE = 250;

/** Sentinel value meaning "no type filter applied". */
const CATEGORY_ALL = 'all';

/** Options for the type <Select> in the toolbar. */
const CATEGORY_OPTIONS: SelectOption[] = [
	{ value: CATEGORY_ALL, label: 'All types' },
	{ value: 'epic', label: 'Epic' },
	{ value: 'task', label: 'Task' },
	{ value: 'bug', label: 'Bug' },
];

/** Toolbar filter state. The server does the filtering; this is only what the toolbar shows. */
interface PlanningFilters {
	search: string;
	/** A value from CATEGORY_OPTIONS, or CATEGORY_ALL for no filter. */
	category: string;
}

/** Drawer min width (matches ItemDrawer) and the board's reserved minimum. */
const DRAWER_MIN_WIDTH = 320;
const BOARD_MIN_WIDTH = 360;

function readStoredView(): PlanningView | undefined {
	const stored = readPref(VIEW_PREF);
	return stored === 'table' || stored === 'board' ? stored : undefined;
}

/**
 * The active view. An explicit `?view=` wins so links stay shareable and
 * back/forward lands where it should; without one, fall back to whichever view
 * the user last picked, then to the board.
 */
function readView(): PlanningView {
	const param = new URLSearchParams(window.location.search).get('view');
	if (param === 'table' || param === 'board') return param;
	return readStoredView() || 'board';
}

/**
 * Planning page container — the route entry for both `/projects/:projectSlug/planning`
 * and `/projects/:projectSlug/planning/items/:itemKey`.
 *
 * Owns all state shared between the Board and Table views (the items collection,
 * selection, create/edit dialog, highlight, and active view) and renders the shared
 * toolbar plus whichever view is active. The two views are purely presentational
 * consumers of this state.
 *
 * The toolbar's filters are the exception: they stop here. The server filters the
 * collection's windows, so the views never see filter state at all — they render
 * whatever the collection currently holds, which under a search includes child items.
 *
 * Which item the drawer shows is not local state — it's the `:itemKey` route param.
 * Opening and closing the drawer are navigations, so the open item has a shareable
 * URL and Back closes it. The router re-renders this same component (no remount) on
 * those navigations, so the board, filters, and scroll position all survive.
 */
export function Planning(props: RouteProps): JSX.Element {
	const projectSlug = props.params.projectSlug || 'demo';
	// Normalized because the server accepts a hand-typed `sb-345`; without this the
	// route key would miss the collection's canonical `SB-345` and open a duplicate,
	// detached model instead of the live one the board is rendering.
	const openItemKey = props.params.itemKey?.toUpperCase();

	// Collection auto-fetches after projectSlug is set. Memoized so it survives view
	// toggles (the route/entry is unchanged, only the ?view= param differs). Its
	// per-status windows start at the size of whichever view opens first.
	const items = useMemo(
		() => new ItemsCollection({
			projectSlug,
			limit: readView() === 'table' ? TABLE_PAGE_SIZE : BOARD_PAGE_SIZE,
		}),
		[projectSlug]
	);
	useModel(items);

	const [view, setView] = useState<PlanningView>(readView);

	// The table shows more per section than the board per column; switching to it
	// widens the windows that had more. Windows never shrink, so board -> table ->
	// board leaves the board showing the wider set.
	useEffect(() => {
		if (view === 'table') void items.ensureLimit(TABLE_PAGE_SIZE);
	}, [view, items]);

	// The toolbar's filter state, and the search text once it has settled. Filtering
	// happens on the server (the views render whatever the collection holds), so the
	// settled text plus the type go to the collection, which reissues its windows.
	const [filters, setFilters] = useState<PlanningFilters>({ search: '', category: CATEGORY_ALL });
	const [settledSearch, setSettledSearch] = useState('');
	useEffect(() => {
		if (filters.search === settledSearch) return;
		// Emptying the box (Clear filters, or deleting the text) is one deliberate act,
		// not a keystroke on the way to another: settle it now, so the results the user
		// just cleared don't sit there for another quarter second.
		if (filters.search.trim() === '') {
			setSettledSearch(filters.search);
			return;
		}
		const timer = setTimeout(() => setSettledSearch(filters.search), SEARCH_DEBOUNCE);
		return () => clearTimeout(timer);
	}, [filters.search, settledSearch]);
	useEffect(() => {
		void items.setFilter({
			search: settledSearch,
			type: filters.category === CATEGORY_ALL ? undefined : (filters.category as ItemType),
		});
	}, [items, settledSearch, filters.category]);

	// The board selection — the single source of truth for which card is marked.
	// Seeded from the route so a deep link lands with its card selected, and kept in
	// step below whenever the route changes under it (deep link, Back/Forward).
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

	// Poll the server for changes, but only while the window has focus — a
	// backgrounded board shouldn't keep hitting the server forever. Losing focus
	// stops the interval; regaining it fetches immediately (so a refocus after the
	// interval elapsed catches up at once) and restarts the timer. Changed items flash.
	useEffect(() => {
		const handleItemsChanged = (ids: string[]): void => flashItems(ids);
		items.onItemsChanged(handleItemsChanged);

		// Once the collection is in an error state (429, expired session, network
		// drop) automatic fetches stop: retrying on a timer is how a rate limit
		// stays tripped. The interval keeps running and stays guarded, so a
		// user-driven fetch that succeeds clears $meta.error and polling resumes
		// with no extra bookkeeping.
		const poll = (): void => {
			if (items.$meta.error) return;
			void items.fetch();
		};

		let interval: ReturnType<typeof setInterval> | undefined;
		const start = (): void => {
			if (interval === undefined) {
				interval = setInterval(poll, POLL_INTERVAL);
			}
		};
		const stop = (): void => {
			if (interval !== undefined) {
				clearInterval(interval);
				interval = undefined;
			}
		};
		const onFocus = (): void => {
			poll();
			start();
		};

		if (document.hasFocus()) start();
		window.addEventListener('focus', onFocus);
		window.addEventListener('blur', stop);

		return () => {
			items.offItemsChanged(handleItemsChanged);
			stop();
			window.removeEventListener('focus', onFocus);
			window.removeEventListener('blur', stop);
		};
	}, [items, flashItems]);

	// Keep the active view in sync with the URL on browser back/forward — the
	// router re-renders this same component on popstate without remounting it,
	// so `view` would otherwise drift from `?view=`.
	useEffect(() => {
		const syncView = (): void => setView(readView());
		window.addEventListener('popstate', syncView);
		return () => window.removeEventListener('popstate', syncView);
	}, []);

	const handleChangeView = useCallback((next: PlanningView): void => {
		setView(next);
		writePref(VIEW_PREF, next);
		// Both views are written explicitly so a history entry is never ambiguous.
		const params = new URLSearchParams(window.location.search);
		params.set('view', next);
		const search = params.toString();
		navigate(window.location.pathname + (search ? `?${search}` : '') + window.location.hash);
	}, []);

	// Selection follows the route whenever the route moves on its own — a deep link,
	// or the user hitting Back/Forward across item URLs.
	useEffect(() => {
		if (openItemKey) setSelectedItemKey(openItemKey);
		else openedByPush.current = false;
	}, [openItemKey]);

	/** Board and item URLs, preserving the query string and hash the user is on. */
	const boardUrl = useCallback(
		(): string => `/projects/${projectSlug}/planning${window.location.search}${window.location.hash}`,
		[projectSlug]
	);
	const itemUrl = useCallback(
		(itemKey: string): string =>
			`/projects/${projectSlug}/planning/items/${itemKey}${window.location.search}${window.location.hash}`,
		[projectSlug]
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
	// only what's loaded, so a rank derived from it would land mid-column.
	const handleCreateItem = useCallback(
		(data: { title: string; description?: string; status: Status; type?: ItemType }): void => {
			items.add({ ...data, type: data.type || createType });
			setIsNewItemDialogOpen(false);
		},
		[items, createType]
	);

	const handleCloseNewItemDialog = useCallback((): void => {
		setIsNewItemDialogOpen(false);
	}, []);

	// Closing undoes our own push where there is one, which leaves the history exactly
	// as it was before the drawer opened. Replacing instead would strand a duplicate
	// board entry, making the next Back appear to do nothing; pushing would make Back
	// reopen the drawer. On a deep link there is nothing of ours to pop, so replace.
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

	const handleDeleteItem = useCallback((item: ItemModel): void => {
		const inCollection = items.find((i) => i.key === item.key);
		if (inCollection) {
			items.remove(inCollection);
		} else {
			// A child opened standalone isn't in the top-level collection — delete it directly.
			void item.delete();
		}
		setSelectedItemKey(undefined);
		navigate(boardUrl(), { replace: true });
	}, [items, boardUrl]);

	const createOptions: SplitButtonOption[] = useMemo(() => [
		{ label: 'Epic', value: 'epic', icon: 'file' as const, onClick: () => handleOpenNewItemDialog('epic') },
		{ label: 'Task', value: 'task', icon: 'checkbox-unchecked' as const, onClick: () => handleOpenNewItemDialog('task') },
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

	const filtersActive = filters.search.trim() !== '' || filters.category !== CATEGORY_ALL;

	const handleClearFilters = useCallback((): void => {
		setFilters({ search: '', category: CATEGORY_ALL });
	}, []);

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
	// fetches its own detail.
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
		() => (standaloneKey ? new ItemModel({ key: standaloneKey, projectSlug }) : undefined),
		[standaloneKey, projectSlug]
	);
	const openItem = collectionItem ?? standaloneItem;

	// A key that resolves to nothing (a stale link, an item someone else deleted) must
	// not render an empty but editable drawer — that offers a Save and a Delete against
	// an item that does not exist. Surface it instead.
	const openItemMissing = Boolean(standaloneItem?.$meta.error);

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

	// Loading state — the first load only. Every later fetch (a poll, a widened
	// window, a new search) keeps the toolbar mounted: swapping it for a spinner
	// would tear the search input out from under the keystroke that caused it.
	if (items.$meta.working && items.$meta.lastFetched === null) {
		return (
			<Page projectSlug={projectSlug} activeTab="Planning">
				<div class={styles.loading}>Loading...</div>
			</Page>
		);
	}

	// Error state from collection's $meta
	if (items.$meta.error) {
		return (
			<Page projectSlug={projectSlug} activeTab="Planning">
				<div class={styles.error}>Error: {items.$meta.error.message}</div>
			</Page>
		);
	}

	return (
		<Page projectSlug={projectSlug} activeTab="Planning">
			<div class={styles.toolbar}>
				<div class={styles.controls}>
					<ViewToggle view={view} onChange={handleChangeView} />
					<div class={styles.filters}>{renderFilters(false)}</div>
				</div>
				<div class={styles.toolbarEnd}>
					<SplitButton options={createOptions} prefix="+ New" />
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

			<div class={styles.workspace} ref={workspaceRefCallback}>
				<div class={styles.viewArea}>
					{view === 'table' ? (
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
							projectSlug={projectSlug}
							selectedItemKey={selectedItemKey}
							flashingIds={flashingIds}
							dialogOpen={isNewItemDialogOpen}
							onSelectItem={handleSelectItem}
							onOpenItem={handleOpenItem}
							onCreateItem={() => handleOpenNewItemDialog('epic')}
						/>
					)}
				</div>

				{openItem && !openItemMissing && (
					<ItemDrawer
						item={openItem}
						projectSlug={projectSlug}
						maxWidth={drawerMaxWidth}
						onClose={handleCloseDrawer}
						onDelete={handleDeleteItem}
						onOpenItem={handleOpenItemByKey}
					/>
				)}
				{openItemMissing && (
					<MissingItemDrawer itemKey={openItemKey!} onClose={handleCloseDrawer} />
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
