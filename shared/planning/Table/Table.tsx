import { useState, useMemo, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { ItemsCollection, type ItemModel, type ItemStatus } from '@specboard/models';
import { Button, Icon, StatusDot } from '@specboard/ui';
import { ItemRow } from './ItemRow';
import { SHOW_DONE_PREF, readPref, writePref } from '../Planning/prefs';
import styles from './Table.module.css';

/** Rows a status section starts with, and how many each "show more" adds. */
export const TABLE_PAGE_SIZE = 200;

/**
 * Status sections, in display order (active work first). Blocked and In Review
 * only appear while something is held there, so the common case stays three
 * sections — but nothing vanishes from the table.
 */
const GROUPS: { status: ItemStatus; label: string; whenNonEmpty?: boolean }[] = [
	{ status: 'in_progress', label: 'In Progress' },
	{ status: 'blocked', label: 'Blocked', whenNonEmpty: true },
	{ status: 'in_review', label: 'In Review', whenNonEmpty: true },
	{ status: 'ready', label: 'Ready' },
	{ status: 'done', label: 'Done' },
];

export interface TableProps {
	/** Shared collection owned by the Planning container. */
	items: ItemsCollection;
	selectedItemKey?: string;
	/** Item keys to briefly flash (newly created, or changed by a background refresh). */
	flashingIds: Set<string>;
	onSelectItem: (item: ItemModel | undefined) => void;
	onOpenItem: (item: ItemModel) => void;
	/** Open a child's detail by key (children are first-class items). */
	onOpenChild?: (itemKey: string) => void;
}

/** Lazily load an epic's tasks the first time it is expanded. */
function ensureTasksLoaded(item: ItemModel): void {
	if (item.$meta.lastFetched == null && !item.$meta.working && item.childStats.total > 0) {
		// Collection items are hydrated without their tasks; fetch the full epic.
		void item.fetch();
	}
}

/**
 * Table view — items grouped by status into divided sections, each an expandable
 * tree row whose children load lazily on first expand.
 *
 * Expansion is off while any filter is active, because an item's `children` load
 * from the unfiltered children endpoint and would show rows the filter excluded.
 * With a search on, it would be worse: matched children are already rows of their
 * own, so expanding their parent would render each a second time as a separate
 * model. A type-only filter still lists top-level items; the rule is the same.
 */
export function Table({
	items,
	selectedItemKey,
	flashingIds,
	onSelectItem,
	onOpenItem,
	onOpenChild,
}: TableProps): JSX.Element {
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	// The Done section is usually the biggest and the least interesting, so it is
	// hidden unless asked for; the choice sticks per browser like the view does.
	const [showDone, setShowDone] = useState<boolean>(() => readPref(SHOW_DONE_PREF) === 'true');
	const toggleShowDone = useCallback((): void => {
		setShowDone((prev) => {
			writePref(SHOW_DONE_PREF, String(!prev));
			return !prev;
		});
	}, []);
	const groups = showDone ? GROUPS : GROUPS.filter((group) => group.status !== 'done');
	// Which sections are fetching their next page; each "Show more" shows its own
	// loading state, so two clicks in flight at once don't clear each other.
	const [loadingMore, setLoadingMore] = useState<ReadonlySet<ItemStatus>>(() => new Set());

	const handleLoadMore = useCallback(async (status: ItemStatus): Promise<void> => {
		setLoadingMore((prev) => new Set(prev).add(status));
		try {
			await items.loadMore(status, TABLE_PAGE_SIZE);
		} finally {
			setLoadingMore((prev) => {
				const next = new Set(prev);
				next.delete(status);
				return next;
			});
		}
	}, [items]);

	// The collection holds exactly what the current query matched, so sections are a
	// plain grouping; a search also matches child items, which appear as rows in the
	// section for their own status, labelled with the parent they hang under.
	const grouped = useMemo(() => {
		const byStatus = {} as Record<ItemStatus, ItemModel[]>;
		for (const group of GROUPS) {
			byStatus[group.status] = items.byStatus(group.status);
		}
		return byStatus;
		// items.version changes on add/remove/status change so the grouping recomputes
		// even though the collection reference is stable.
	}, [items, items.version]);

	const expandable = !items.filterActive;

	const toggleExpand = useCallback((item: ItemModel): void => {
		const willExpand = !expanded.has(item.id);
		if (willExpand) ensureTasksLoaded(item);
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(item.id)) {
				next.delete(item.id);
			} else {
				next.add(item.id);
			}
			return next;
		});
	}, [expanded]);

	const expandAll = useCallback((): void => {
		const ids = new Set<string>();
		for (const group of groups) {
			for (const item of grouped[group.status]) {
				if (item.childStats.total > 0) {
					ids.add(item.id);
					ensureTasksLoaded(item);
				}
			}
		}
		setExpanded(ids);
	}, [grouped, groups]);

	const collapseAll = useCallback((): void => {
		setExpanded(new Set());
	}, []);

	return (
		<div class={styles.wrapper}>
			<div class={styles.actions}>
				{expandable && (
					<>
						<button type="button" class="secondary size-sm" onClick={expandAll}>
							Expand all
						</button>
						<button type="button" class="secondary size-sm" onClick={collapseAll}>
							Collapse all
						</button>
					</>
				)}
				<Button class={`secondary size-sm ${styles.toggle}`} aria-pressed={showDone} onClick={toggleShowDone}>
					{/* Both states carry a box so the button's width never shifts on toggle. */}
					<Icon name={showDone ? 'checkbox-checked' : 'checkbox-unchecked'} class="size-sm" />
					Show done
				</Button>
			</div>

			<div class={styles.table} role="table">
				<div class={`${styles.row} ${styles.columnHeader}`} role="row">
					<span class={styles.colType} role="columnheader">Type</span>
					<span class={styles.colTitle} role="columnheader">Title</span>
					<span class={styles.colStatus} role="columnheader">Status</span>
					<span class={styles.colTasks} role="columnheader">Tasks</span>
					<span class={styles.colAssignee} role="columnheader">Assignee</span>
				</div>

				{groups.map(({ status, label, whenNonEmpty }) => {
					const groupItems = grouped[status];
					if (whenNonEmpty && groupItems.length === 0) return null;
					return (
						<div key={status} class={styles.group} role="rowgroup">
							<div class={styles.groupHeader} role="row">
								<span class={styles.groupHeaderCell} role="columnheader" aria-colspan={5}>
									<StatusDot status={status} />
									<span class={styles.groupLabel}>{label}</span>
									<span class={styles.groupCount}>{items.totalFor(status)}</span>
								</span>
							</div>

							{groupItems.length === 0 ? (
								<div class={styles.empty} role="row">
									<span role="cell">No items</span>
								</div>
							) : (
								groupItems.map((item) => (
									<ItemRow
										key={item.id}
										item={item}
										expandable={expandable}
										expanded={expanded.has(item.id)}
										selected={item.key === selectedItemKey}
										flashing={flashingIds.has(item.key)}
										onToggle={toggleExpand}
										onOpen={onOpenItem}
										onSelect={onSelectItem}
										onOpenChild={onOpenChild}
									/>
								))
							)}

							{items.hasMore(status) && (
								<div class={styles.showMoreRow} role="row">
									<span class={styles.showMoreCell} role="cell" aria-colspan={5}>
										<button
											type="button"
											class="text size-sm"
											onClick={() => void handleLoadMore(status)}
											disabled={loadingMore.has(status)}
										>
											{loadingMore.has(status) ? 'Loading…' : 'Show more'}
										</button>
										<span class={styles.showMoreCount}>{items.loadedFor(status)} of {items.totalFor(status)}</span>
									</span>
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
