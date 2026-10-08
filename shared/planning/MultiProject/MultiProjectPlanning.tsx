import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { navigate } from '@specboard/router';
import { parseItemKey } from '@specboard/core/identifiers';
import { fetchClient } from '@specboard/fetch';
import { ItemsCollection, useModel, type ItemModel, type ItemType } from '@specboard/models';
import { Badge, Icon, Notice, Page, Select, Text } from '@specboard/ui';
import { LoadError } from '../LoadError/LoadError';
import { Table, TABLE_PAGE_SIZE } from '../Table/Table';
import { COMBINED_POLL_INTERVAL, usePolling } from '../hooks/usePolling';
import { CATEGORY_ALL, CATEGORY_OPTIONS, isItemType, useSettledSearch, type PlanningFilters } from '../Planning/filters';
import type { ProjectLabel } from '../ProjectChip/ProjectChip';
import { MergedItems } from './merged-items';
import {
	leftOutNotices,
	multiProjectUrl,
	parseSelection,
	resolveSelection,
	type ListedProject,
	type ResolvedSelection,
} from './selection';
import styles from './MultiProjectPlanning.module.css';

/**
 * The multi-project view, `/planning?projects=<ref>,<ref>` (docs/specs/multi-project-view.md):
 * the items of several projects mixed into one read-only Table. The address is the whole
 * state, the selection and the toolbar's filters both, so it can be bookmarked or sent,
 * and Back from an item (which opens in its own project) lands on the view as it was left.
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
function readAddressFilters(): { search: string; type: ItemType | undefined } {
	const params = new URLSearchParams(window.location.search);
	const type = params.get('type') ?? '';
	return { search: params.get('search') ?? '', type: isItemType(type) ? type : undefined };
}

function itemPage(projectRef: string, itemKey: string): string {
	return `/projects/${projectRef}/items/${itemKey}`;
}

interface CombinedViewProps {
	/** Every ref the address asked for, kept as asked when the address is rewritten. */
	refs: string[];
	resolved: ResolvedSelection;
}

function CombinedView({ refs, resolved }: CombinedViewProps): JSX.Element {
	const { projects } = resolved;
	const [addressFilters] = useState(readAddressFilters);

	// One collection per project, against its own endpoints and authorization; the merge
	// only reads across them. The table's window size, since the Table is the only view here.
	const items = useMemo(
		() => new MergedItems(projects.map((project) => new ItemsCollection({
			projectRef: project.ref,
			limit: TABLE_PAGE_SIZE,
			initialFilter: addressFilters,
		}))),
		[projects, addressFilters]
	);
	useModel(items);

	const [filters, setFilters] = useState<PlanningFilters>({
		search: addressFilters.search,
		category: addressFilters.type ?? CATEGORY_ALL,
	});
	const settledSearch = useSettledSearch(filters.search);
	const type = isItemType(filters.category) ? filters.category : undefined;
	useEffect(() => {
		void items.setFilter({ search: settledSearch, type });
		// Replaced rather than pushed: a filter refines this place, it isn't a new one.
		const view = new URLSearchParams(window.location.search).get('view') ?? undefined;
		const url = multiProjectUrl(refs, { view, search: settledSearch.trim(), type });
		if (url !== window.location.pathname + window.location.search) {
			window.history.replaceState(window.history.state, '', url);
		}
	}, [items, refs, settledSearch, type]);

	// The same focus rule and error suspension as a board's poll, at the slower cadence.
	usePolling(() => void items.fetch(), () => items.$meta.error !== null, COMBINED_POLL_INTERVAL);

	const labels = useMemo(() => new Map(projects.map((project) => [project.ref, project])), [projects]);
	const dropped = items.dropped;
	const shown = projects.filter((project) => !dropped.includes(project.ref));
	const notices = leftOutNotices(
		[...resolved.missing, ...projects.filter((project) => dropped.includes(project.ref)).map((project) => project.name)],
		resolved.clashes
	);

	// An item opens on its own page in its own project, where the person's role there
	// decides what they can change. Pushed, so Back returns here.
	const handleOpenItem = useCallback((item: ItemModel): void => navigate(itemPage(item.projectRef, item.key)), []);
	// A child row only knows its key, but no two projects here share a key prefix, so
	// the prefix names the project, which is its parent's.
	const handleOpenChild = useCallback((itemKey: string): void => {
		const prefix = parseItemKey(itemKey)?.projectKey;
		const project = projects.find((candidate) => candidate.key === prefix);
		if (project) navigate(itemPage(project.ref, itemKey));
	}, [projects]);

	const handleRetry = useCallback((): void => {
		void items.fetch({ force: true });
	}, [items]);

	const handleSearchInput = useCallback((e: Event): void => {
		const value = (e.target as HTMLInputElement).value;
		setFilters((prev) => ({ ...prev, search: value }));
	}, []);

	const handleCategoryChange = useCallback((e: Event): void => {
		const value = (e.target as HTMLSelectElement).value;
		setFilters((prev) => ({ ...prev, category: value }));
	}, []);

	// Every project dropped: the one notice is the whole story, so it's the page.
	if (shown.length === 0) {
		return <Unavailable title="None of these projects can be shown" detail={notices.join(' ')} />;
	}

	const renderViewArea = (): JSX.Element => {
		const loadError = items.$meta.error;
		if (loadError) return <LoadError error={loadError} onRetry={handleRetry} />;
		if (items.$meta.lastFetched === null) return <div class={styles.loading}>Loading...</div>;
		return (
			<Table
				items={items}
				projects={labels}
				onOpenItem={handleOpenItem}
				onOpenChild={handleOpenChild}
			/>
		);
	};

	return (
		<>
			<div class={styles.toolbar}>
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
						onInput={handleSearchInput}
					/>
					<Select
						compact
						value={filters.category}
						options={CATEGORY_OPTIONS}
						ariaLabel="Item type"
						onChange={handleCategoryChange}
					/>
				</div>
			</div>

			<div class={styles.notices} role="status">
				{notices.map((notice) => <Notice key={notice} variant="warning">{notice}</Notice>)}
			</div>

			<div class={styles.viewArea}>{renderViewArea()}</div>
		</>
	);
}

/** A chosen project in the toolbar: its name and key prefix, linking to its own planning view. */
function ProjectLink({ project }: { project: ProjectLabel }): JSX.Element {
	return (
		<a class={styles.project} href={`/projects/${project.ref}/planning`} title={project.ref}>
			<span class={styles.projectName}>{project.name}</span>
			<Badge class={styles.projectKey}>{project.key}</Badge>
		</a>
	);
}
