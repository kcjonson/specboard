import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { formatItemKey, parseItemKey } from '@specboard/core/identifiers';
import { fetchClient } from '@specboard/fetch';
import { ItemModel, ItemsCollection, useModel } from '@specboard/models';
import { Icon, Notice, Page, Select, Text } from '@specboard/ui';
import { Board, BOARD_PAGE_SIZE } from '../Board/Board';
import { ItemDrawer } from '../ItemDrawer/ItemDrawer';
import { LoadError } from '../LoadError/LoadError';
import type { MapProjectFailure } from '../Map/map-data-model';
import { Table, TABLE_PAGE_SIZE } from '../Table/Table';
import { ViewToggle } from '../ViewToggle/ViewToggle';
import { Workspace } from '../Workspace/Workspace';
import { useDrawerHistory } from '../hooks/useDrawerHistory';
import { COMBINED_POLL_INTERVAL, usePolling } from '../hooks/usePolling';
import { CATEGORY_OPTIONS, isItemType, usePlanningFilters, type PlanningFiltersInit } from '../Planning/filters';
import { useMapView } from '../Planning/useMapView';
import { readView, usePlanningView } from '../Planning/view';
import { ProjectKey, type ProjectLabel } from '../ProjectChip/ProjectChip';
import { withQuery } from '../utils/address';
import { MergedItems } from './merged-items';
import {
	leftOutNotices,
	mapTroubleNotices,
	parseSelection,
	resolveSelection,
	type ListedProject,
	type ResolvedSelection,
} from './selection';
import styles from './MultiProjectPlanning.module.css';

/**
 * The multi-project view, `/planning?projects=<ref>,<ref>` (docs/specs/multi-project-view.md):
 * the items of several projects mixed into one read-only Board, Table, or Map. The address
 * is the whole state, the selection, the view, the toolbar's filters, and the open item,
 * so it can be bookmarked or sent, and a reload lands where it was.
 *
 * Nothing here is project-scoped: the header has no Planning/Pages tabs, and nothing
 * writes the last-project cookies.
 */
export function MultiProjectPlanning(): JSX.Element {
	const param = new URLSearchParams(window.location.search).get('projects');
	const selection = useMemo(() => parseSelection(param), [param]);
	return (
		<Page title="Multi-project view">
			{selection.ok ? (
				<SelectedProjects key={selection.refs.join(',')} refs={selection.refs} />
			) : (
				<Unavailable title="These projects can't be viewed together" detail={selection.problem} />
			)}
		</Page>
	);
}

function Unavailable({ title, detail }: { title: string; detail: string }): JSX.Element {
	return (
		<div class={styles.message}>
			<h2>{title}</h2>
			<p>{detail}</p>
			<a href="/projects" class={styles.back}>
				<Icon name="arrow-left" class="size-sm" /> Choose projects
			</a>
		</div>
	);
}

/** Matches the requested refs against the projects this person can read. */
function SelectedProjects({ refs }: { refs: string[] }): JSX.Element {
	const [listed, setListed] = useState<ListedProject[] | null>(null);
	const [error, setError] = useState<Error | null>(null);
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		let current = true;
		setError(null);
		fetchClient.get<ListedProject[]>('/api/projects').then(
			(projects) => {
				if (current) setListed(projects);
			},
			(failure: unknown) => {
				if (current) setError(failure instanceof Error ? failure : new Error(String(failure)));
			},
		);
		return () => {
			current = false;
		};
	}, [attempt]);

	const resolved = useMemo(() => (listed ? resolveSelection(refs, listed) : null), [refs, listed]);
	const retry = useCallback((): void => setAttempt((n) => n + 1), []);

	if (error) return <LoadError error={error} onRetry={retry} />;
	if (!resolved) return <div class={styles.loading}>Loading...</div>;
	return <CombinedView refs={refs} resolved={resolved} />;
}

/** The filters the address carries, for a view coming back to where it was left. */
function readAddressFilters(): PlanningFiltersInit {
	const params = new URLSearchParams(window.location.search);
	const type = params.get('type') ?? '';
	return { search: params.get('search') ?? '', type: isItemType(type) ? type : undefined };
}

/** The item the address opens, `&item=<KEY>`, in the canonical form the collections key on. */
function readOpenItem(): string | undefined {
	const parsed = parseItemKey(new URLSearchParams(window.location.search).get('item') ?? '');
	return parsed ? formatItemKey(parsed.projectKey, parsed.number) : undefined;
}

/** The address with the drawer showing `itemKey`, or none for undefined. */
function drawerAddress(itemKey: string | undefined): string {
	return withQuery(window.location, { item: itemKey });
}

/** Until the Map says otherwise, every project's reads are landing. */
const NO_FAILURES: ReadonlyMap<string, MapProjectFailure> = new Map();

interface CombinedViewProps {
	/** Every ref the address asked for, written back in their canonical form. */
	refs: string[];
	resolved: ResolvedSelection;
}

function CombinedView({ refs, resolved }: CombinedViewProps): JSX.Element {
	const { projects } = resolved;
	const [addressFilters] = useState(readAddressFilters);
	const { filters, settledSearch, type, onSearchInput, onCategoryChange, clear, restore } = usePlanningFilters(addressFilters);
	const { view, small, changeView } = usePlanningView();
	const onMap = view === 'map';

	// One collection per project, against its own endpoints and authorization; the merge
	// only reads across them. Their windows start at the size of whichever view opens first.
	// Keyed on the refs themselves: the same projects in a new array (a re-render after the
	// address was normalized, say) must not rebuild and refetch every collection.
	const projectsKey = projects.map((project) => project.ref).join(',');
	const items = useMemo(
		() => new MergedItems(projects.map((project) => new ItemsCollection({
			projectRef: project.ref,
			limit: readView() === 'table' ? TABLE_PAGE_SIZE : BOARD_PAGE_SIZE,
			initialFilter: addressFilters,
		}))),
		[projectsKey, addressFilters]
	);
	useModel(items);

	// The Table shows more per section than the Board per column; switching to it widens
	// the windows that had more, and they never shrink back.
	useEffect(() => {
		if (view === 'table') void items.ensureLimit(TABLE_PAGE_SIZE);
	}, [view, items]);

	// The Map dims by the same search and type rather than narrowing the windows, which
	// catch up when the Board or Table comes back.
	useEffect(() => {
		if (!onMap) void items.setFilter({ search: settledSearch, type });
	}, [items, onMap, settledSearch, type]);
	// Replaced rather than pushed: a filter refines this place, it isn't a new one. The refs go
	// back as parsed, so an address typed by hand settles into its canonical form.
	useEffect(() => {
		const url = withQuery(window.location, { projects: refs.join(','), search: settledSearch.trim() || undefined, type });
		if (url !== window.location.pathname + window.location.search + window.location.hash) {
			window.history.replaceState(window.history.state, '', url);
		}
	}, [refs, settledSearch, type]);

	// Back and Forward between entries of this view re-render it in place, so the filters
	// follow the address the way the view does.
	useEffect(() => {
		const sync = (): void => restore(readAddressFilters());
		window.addEventListener('popstate', sync);
		return () => window.removeEventListener('popstate', sync);
	}, [restore]);

	// The same focus rule and error suspension as a board's poll, at the slower cadence.
	// The drawer's top-level item lives in these collections, so they poll on the Map too.
	usePolling(() => void items.fetch(), () => items.$meta.error !== null, COMBINED_POLL_INTERVAL);

	// The Map reads each project itself, so it reports the projects whose reads are failing.
	const { MapView, error: mapError, retry: retryMap } = useMapView(onMap);
	const mapScope = useMemo(() => ({ projects }), [projects]);
	const [mapFailures, setMapFailures] = useState(NO_FAILURES);

	// Every project in trouble is named once. One the lists or the Map can no longer read
	// leaves the view, whichever found out first; while the Map shows, the notice also says
	// which projects it is still trying to read, drawn as last loaded or not drawn at all.
	const unreadable = new Set(items.dropped);
	for (const [ref, failure] of mapFailures) if (failure.unreadable) unreadable.add(ref);
	const shown = projects.filter((project) => !unreadable.has(project.ref));
	const lone = shown.length === 1 ? shown[0] : undefined;
	const leftOut = leftOutNotices(
		[...resolved.missing, ...projects.filter((project) => unreadable.has(project.ref)).map((project) => project.name)],
		resolved.clashes
	);
	const troubled = (held: boolean): string[] => shown
		.filter((project) => mapFailures.get(project.ref)?.held === held)
		.map((project) => project.name);
	const trouble = onMap ? mapTroubleNotices(troubled(true), troubled(false)) : [];
	const labels = useMemo(() => new Map(projects.map((project) => [project.ref, project])), [projects]);

	// The drawer shows the address's `item=` (decision 7). Each item is opened in the
	// project of the card, row, or dot it was opened from; only a key that came in on
	// the address alone (a reload, a pasted link) goes by its prefix, which names one
	// project at most, since no two projects here share one.
	const openedIn = useRef(new Map<string, string>());
	const requestedKey = readOpenItem();
	const openRef = requestedKey === undefined
		? undefined
		: openedIn.current.get(requestedKey) ?? projects.find((project) => project.key === parseItemKey(requestedKey)?.projectKey)?.ref;
	const openProject = shown.find((project) => project.ref === openRef);
	const openItemKey = openProject ? requestedKey : undefined;
	const drawer = useDrawerHistory(openItemKey, drawerAddress, view === 'table');
	const { open: openDrawer, select: selectInDrawer } = drawer;

	const openItem = useCallback((itemKey: string, projectRef: string): void => {
		openedIn.current.set(itemKey, projectRef);
		openDrawer(itemKey);
	}, [openDrawer]);
	const handleOpenItem = useCallback((item: ItemModel): void => openItem(item.key, item.projectRef), [openItem]);
	const handleSelectItem = useCallback((item: ItemModel | undefined): void => {
		if (item) openedIn.current.set(item.key, item.projectRef);
		selectInDrawer(item);
	}, [selectInDrawer]);
	// Whatever the open item links to (its children, its parent, its blockers) is in its own project.
	const handleOpenRelated = useCallback((itemKey: string): void => {
		if (openRef) openItem(itemKey, openRef);
	}, [openItem, openRef]);

	// A listed item uses its project's live model; anything else (a child, or an item past
	// the loaded windows) gets a standalone one in its project once the lists have loaded,
	// so nothing is built for an item that is merely still loading.
	const collectionItem = openProject
		? items.find((item) => item.key === openItemKey && item.projectRef === openProject.ref)
		: undefined;
	const standaloneKey = openItemKey && !collectionItem && items.$meta.lastFetched !== null ? openItemKey : undefined;
	const standaloneRef = standaloneKey ? openProject?.ref : undefined;
	const standaloneItem = useMemo(
		() => (standaloneKey && standaloneRef ? new ItemModel({ key: standaloneKey, projectRef: standaloneRef }) : undefined),
		[standaloneKey, standaloneRef]
	);
	const drawerItem = collectionItem ?? standaloneItem;
	// The Map has the drawer overlay it rather than narrow it, and needs to know how much it covers.
	const [drawerWidth, setDrawerWidth] = useState(0);

	const handleRetry = useCallback((): void => {
		void items.fetch({ force: true });
	}, [items]);

	// Every project dropped: the one notice is the whole story, so it's the page.
	if (shown.length === 0) {
		return <Unavailable title="None of these projects can be shown" detail={leftOut.join(' ')} />;
	}

	const renderViewArea = (): JSX.Element => {
		// The Map is a lazy chunk with reads of its own, so the lists' loading and errors say nothing about it.
		if (onMap) {
			if (mapError) return <LoadError error={mapError} onRetry={retryMap} />;
			if (!MapView) return <div class={styles.loading}>Loading...</div>;
			return (
				<MapView
					scope={mapScope}
					openItemKey={openItemKey}
					covered={drawerItem ? drawerWidth : 0}
					onOpenItem={openItem}
					onCloseItem={drawer.close}
					search={settledSearch}
					type={type ?? null}
					onClear={clear}
					onFailures={setMapFailures}
				/>
			);
		}
		const loadError = items.$meta.error;
		if (loadError) return <LoadError error={loadError} onRetry={handleRetry} />;
		if (items.$meta.lastFetched === null) return <div class={styles.loading}>Loading...</div>;
		return view === 'table' ? (
			<Table
				items={items}
				projects={labels}
				selectedItemKey={drawer.selectedItemKey}
				onSelectItem={handleSelectItem}
				onOpenItem={handleOpenItem}
				onOpenChild={openItem}
			/>
		) : (
			<Board
				items={items}
				canEdit={false}
				projects={labels}
				selectedItemKey={drawer.selectedItemKey}
				onSelectItem={handleSelectItem}
				onOpenItem={handleOpenItem}
			/>
		);
	};

	return (
		<>
			<div class={styles.toolbar}>
				<ViewToggle view={view} onChange={changeView} mapAvailable={!small} />
				<ul class={styles.projects} aria-label="Projects in this view">
					{shown.map((project) => (
						<li key={project.ref}>
							<ProjectLink project={project} />
						</li>
					))}
				</ul>
				<div class={styles.filters}>
					<Text
						type="search"
						compact
						value={filters.search}
						placeholder="Search items..."
						ariaLabel="Search items"
						onInput={onSearchInput}
					/>
					<Select
						compact
						value={filters.category}
						options={CATEGORY_OPTIONS}
						ariaLabel="Item type"
						onChange={onCategoryChange}
					/>
				</div>
			</div>

			{/* Always present, so a project dropped mid-session is announced. With anything left
			    out there's a way back to choose again, and a lone project left over can simply
			    be opened on its own. */}
			<div class={styles.notices} role="status">
				{(leftOut.length > 0 || trouble.length > 0) && (
					<Notice variant="warning" class={styles.leftOut}>
						<span class={styles.leftOutText}>
							{[...leftOut, ...trouble].map((notice) => <span key={notice}>{notice}</span>)}
						</span>
						{leftOut.length > 0 && (
							<span class={styles.leftOutLinks}>
								<a href="/projects">Choose projects</a>
								{lone && <a href={`/projects/${lone.ref}/planning`}>Open {lone.name} on its own</a>}
							</span>
						)}
					</Notice>
				)}
			</div>

			<Workspace
				overlay={onMap}
				drawer={drawerItem && openProject ? (maxWidth) => (
					<ItemDrawer
						item={drawerItem}
						listed={collectionItem !== undefined}
						canEdit={false}
						project={openProject}
						maxWidth={maxWidth}
						onClose={drawer.close}
						onResize={setDrawerWidth}
						onOpenItem={handleOpenRelated}
					/>
				) : null}
			>
				{renderViewArea()}
			</Workspace>
		</>
	);
}

/** A chosen project in the toolbar: its name and key prefix, linking to its own planning view. */
function ProjectLink({ project }: { project: ProjectLabel }): JSX.Element {
	return (
		<a class={styles.project} href={`/projects/${project.ref}/planning`} title={project.ref}>
			<span class={styles.projectName}>{project.name}</span>
			<ProjectKey prefix={project.key} />
		</a>
	);
}
