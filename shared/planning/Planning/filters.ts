import { useCallback, useEffect, useState } from 'preact/hooks';
import type { ItemType } from '@specboard/models';
import type { SelectOption } from '@specboard/ui';

/**
 * How long the search box sits still before its text becomes a new query. Each
 * change costs one request per status window, so keystrokes are collapsed; the
 * type Select is a single deliberate choice and applies immediately.
 */
const SEARCH_DEBOUNCE = 250;

/** Sentinel value meaning "no type filter applied". */
const CATEGORY_ALL = 'all';

/** Options for the type <Select> in a planning toolbar. */
export const CATEGORY_OPTIONS: SelectOption[] = [
	{ value: CATEGORY_ALL, label: 'All types' },
	{ value: 'epic', label: 'Epic' },
	{ value: 'task', label: 'Task' },
	{ value: 'bug', label: 'Bug' },
];

/** The real item types among CATEGORY_OPTIONS, excluding the CATEGORY_ALL sentinel. */
const ITEM_TYPES = new Set(CATEGORY_OPTIONS.map((option) => option.value).filter((value) => value !== CATEGORY_ALL));

export function isItemType(value: string): value is ItemType {
	return ITEM_TYPES.has(value);
}

/** Toolbar filter state. The server does the filtering; this is only what the toolbar shows. */
export interface PlanningFilters {
	search: string;
	/** A value from CATEGORY_OPTIONS, or CATEGORY_ALL for no filter. */
	category: string;
}

/** Filters as a view starts from or returns to them: none, or ones its address carried. */
export interface PlanningFiltersInit {
	search?: string;
	type?: ItemType;
}

/** A planning toolbar's search box and type filter, and what they ask the server for. */
export interface PlanningFiltersControl {
	/** What the toolbar's controls show. */
	filters: PlanningFilters;
	/** The search text once it has stopped changing: what a query should carry. */
	settledSearch: string;
	/** The chosen type, or undefined for every type. */
	type: ItemType | undefined;
	/** Whether either filter holds anything. */
	active: boolean;
	onSearchInput: (e: Event) => void;
	onCategoryChange: (e: Event) => void;
	clear: () => void;
	/** Sets both, already settled, as when Back or Forward lands on an address that carries them. */
	restore: (to: PlanningFiltersInit) => void;
}

function toFilters({ search = '', type }: PlanningFiltersInit): PlanningFilters {
	return { search, category: type ?? CATEGORY_ALL };
}

/**
 * The toolbar filters every planning view shares, starting from `initial` (read once, on
 * the first render). The search is debounced before it settles, since each settled
 * search is a new query; the type applies at once. Emptying the box (Clear filters, or
 * deleting the text) is one deliberate act, not a keystroke on the way to another, so it
 * settles at once and the results just cleared don't sit there a quarter second more.
 * So does `restore`: filters an address carried were settled when they were written.
 */
export function usePlanningFilters(initial: PlanningFiltersInit = {}): PlanningFiltersControl {
	const [filters, setFilters] = useState<PlanningFilters>(() => toFilters(initial));
	const [settledSearch, setSettledSearch] = useState(filters.search);

	useEffect(() => {
		if (filters.search === settledSearch) return;
		if (filters.search.trim() === '') {
			setSettledSearch(filters.search);
			return;
		}
		const timer = setTimeout(() => setSettledSearch(filters.search), SEARCH_DEBOUNCE);
		return () => clearTimeout(timer);
	}, [filters.search, settledSearch]);

	const onSearchInput = useCallback((e: Event): void => {
		const value = (e.target as HTMLInputElement).value;
		setFilters((prev) => ({ ...prev, search: value }));
	}, []);

	const onCategoryChange = useCallback((e: Event): void => {
		const value = (e.target as HTMLSelectElement).value;
		setFilters((prev) => ({ ...prev, category: value }));
	}, []);

	const restore = useCallback((to: PlanningFiltersInit): void => {
		const next = toFilters(to);
		setFilters(next);
		setSettledSearch(next.search);
	}, []);
	const clear = useCallback((): void => restore({}), [restore]);

	return {
		filters,
		settledSearch,
		type: isItemType(filters.category) ? filters.category : undefined,
		active: filters.search.trim() !== '' || filters.category !== CATEGORY_ALL,
		onSearchInput,
		onCategoryChange,
		clear,
		restore,
	};
}
