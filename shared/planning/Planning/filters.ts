import { useEffect, useState } from 'preact/hooks';
import type { ItemType } from '@specboard/models';
import type { SelectOption } from '@specboard/ui';

/**
 * How long the search box sits still before its text becomes a new query. Each
 * change costs one request per status window, so keystrokes are collapsed; the
 * type Select is a single deliberate choice and applies immediately.
 */
const SEARCH_DEBOUNCE = 250;

/** Sentinel value meaning "no type filter applied". */
export const CATEGORY_ALL = 'all';

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

/**
 * The search text once it has stopped changing. Emptying the box (Clear filters, or
 * deleting the text) is one deliberate act, not a keystroke on the way to another, so
 * it settles at once and the results just cleared don't sit there a quarter second more.
 */
export function useSettledSearch(search: string): string {
	const [settled, setSettled] = useState(search);
	useEffect(() => {
		if (search === settled) return;
		if (search.trim() === '') {
			setSettled(search);
			return;
		}
		const timer = setTimeout(() => setSettled(search), SEARCH_DEBOUNCE);
		return () => clearTimeout(timer);
	}, [search, settled]);
	return settled;
}
