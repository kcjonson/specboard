import { useMemo } from 'preact/hooks';
import { ItemModel } from '@specboard/models';

/** The lists the drawer's item may be one of: one project's collection, or several merged. */
export interface DrawerItemSource {
	find(predicate: (item: ItemModel) => boolean): ItemModel | undefined;
	readonly $meta: { readonly lastFetched: number | null };
}

export interface DrawerItem {
	/** The model the drawer shows, once there is one to show. */
	item: ItemModel | undefined;
	/** It's a row of the loaded lists, so it's known to exist before its detail arrives (ItemDrawer's `listed`). */
	listed: boolean;
}

/**
 * The model the drawer shows for an item. A listed item uses its live collection model, so
 * edits reflect in the view at once. Anything else (a child, or an item the lists have
 * dropped) gets a standalone model in its project that fetches its own detail, and the
 * drawer stays inert until that fetch lands.
 *
 * The lists are a stable reference whose contents change, so the lookup runs every render
 * (a cheap scan) rather than inside the memo: memoizing it meant that when a poll dropped
 * the open item, the cached `undefined` stood and the drawer silently vanished mid-edit.
 * Waiting for the lists' first fetch avoids building a standalone model for an item that
 * is merely still loading.
 */
export function useDrawerItem(items: DrawerItemSource, itemKey: string | undefined, projectRef: string | undefined): DrawerItem {
	const listedItem = itemKey && projectRef
		? items.find((item) => item.key === itemKey && item.projectRef === projectRef)
		: undefined;
	const standaloneKey = itemKey && projectRef && !listedItem && items.$meta.lastFetched !== null ? itemKey : undefined;
	const standalone = useMemo(
		() => (standaloneKey && projectRef ? new ItemModel({ key: standaloneKey, projectRef }) : undefined),
		[standaloneKey, projectRef]
	);
	return { item: listedItem ?? standalone, listed: listedItem !== undefined };
}
