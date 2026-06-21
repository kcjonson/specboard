/**
 * Planning toolbar filter logic — shared by the Board and Table views.
 *
 * The "category" filter operates on the item `type` field. To filter a different
 * field instead (e.g. subStatus or assignee), change CATEGORY_OPTIONS and the
 * comparison in `matchesFilters` — both live here so the filtered field is a
 * single, localized change.
 */

import type { ItemModel } from '@specboard/models';
import type { SelectOption } from '@specboard/ui';

/** Sentinel value meaning "no category filter applied". */
export const CATEGORY_ALL = 'all';

/** Options for the category <Select> in the toolbar. */
export const CATEGORY_OPTIONS: SelectOption[] = [
	{ value: CATEGORY_ALL, label: 'All types' },
	{ value: 'epic', label: 'Epic' },
	{ value: 'chore', label: 'Chore' },
	{ value: 'bug', label: 'Bug' },
];

/** Filter state shared across views. */
export interface PlanningFilters {
	/** Free-text search (matched case-insensitively against title + description). */
	search: string;
	/** Category value from CATEGORY_OPTIONS, or CATEGORY_ALL for no filter. */
	category: string;
}

/** True when no filter is active (used to skip work / show all items). */
export function isFilterActive(filters: PlanningFilters): boolean {
	return filters.search.trim() !== '' || filters.category !== CATEGORY_ALL;
}

/**
 * Predicate combining search + category with AND semantics.
 */
export function matchesFilters(item: ItemModel, filters: PlanningFilters): boolean {
	if (filters.category !== CATEGORY_ALL && item.type !== filters.category) {
		return false;
	}

	const query = filters.search.trim().toLowerCase();
	if (query) {
		const haystack = `${item.title} ${item.description ?? ''}`.toLowerCase();
		if (!haystack.includes(query)) {
			return false;
		}
	}

	return true;
}
