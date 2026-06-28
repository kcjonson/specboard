import { useState, useMemo, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { ItemsCollection, type ItemModel, type Status } from '@specboard/models';
import { StatusDot } from '@specboard/ui';
import { ItemRow } from './ItemRow';
import { matchesFilters, type PlanningFilters } from '../Planning/filters';
import styles from './Table.module.css';

/** Status sections, in display order (active work first). */
const GROUPS: { status: Status; label: string }[] = [
	{ status: 'in_progress', label: 'In Progress' },
	{ status: 'ready', label: 'Ready' },
	{ status: 'done', label: 'Done' },
];

export interface TableProps {
	/** Shared collection owned by the Planning container. */
	items: ItemsCollection;
	/** Active toolbar filters (applied to the epics shown). */
	filters: PlanningFilters;
	selectedItemId?: string;
	onSelectItem: (item: ItemModel | undefined) => void;
	onOpenItem: (item: ItemModel) => void;
	/** Open a child's detail by id (children are first-class items). */
	onOpenChild?: (itemId: string) => void;
}

/** Lazily load an epic's tasks the first time it is expanded. */
function ensureTasksLoaded(item: ItemModel): void {
	if (item.$meta.lastFetched == null && !item.$meta.working && item.childStats.total > 0) {
		// Collection items are hydrated without their tasks; fetch the full epic.
		void item.fetch();
	}
}

/**
 * Table view — epics grouped by status into divided sections, each epic an
 * expandable tree row whose task children load lazily on first expand.
 */
export function Table({
	items,
	filters,
	selectedItemId,
	onSelectItem,
	onOpenItem,
	onOpenChild,
}: TableProps): JSX.Element {
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const grouped = useMemo(
		() => ({
			in_progress: items.byStatus('in_progress').filter((i) => matchesFilters(i, filters)),
			ready: items.byStatus('ready').filter((i) => matchesFilters(i, filters)),
			done: items.byStatus('done').filter((i) => matchesFilters(i, filters)),
		}),
		[items, filters]
	);

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
		for (const group of GROUPS) {
			for (const item of grouped[group.status]) {
				if (item.childStats.total > 0) {
					ids.add(item.id);
					ensureTasksLoaded(item);
				}
			}
		}
		setExpanded(ids);
	}, [grouped]);

	const collapseAll = useCallback((): void => {
		setExpanded(new Set());
	}, []);

	return (
		<div class={styles.wrapper}>
			<div class={styles.actions}>
				<button type="button" class={styles.actionButton} onClick={expandAll}>
					Expand all
				</button>
				<button type="button" class={styles.actionButton} onClick={collapseAll}>
					Collapse all
				</button>
			</div>

			<div class={styles.table} role="table">
				<div class={`${styles.row} ${styles.columnHeader}`} role="row">
					<span class={styles.colTitle} role="columnheader">Title</span>
					<span class={styles.colType} role="columnheader">Type</span>
					<span class={styles.colStatus} role="columnheader">Status</span>
					<span class={styles.colTasks} role="columnheader">Tasks</span>
					<span class={styles.colAssignee} role="columnheader">Assignee</span>
				</div>

				{GROUPS.map(({ status, label }) => {
					const groupItems = grouped[status];
					return (
						<div key={status} class={styles.group} role="rowgroup">
							<div class={styles.groupHeader} role="row">
								<span class={styles.groupHeaderCell} role="columnheader" aria-colspan={5}>
									<StatusDot status={status} />
									<span class={styles.groupLabel}>{label}</span>
									<span class={styles.groupCount}>{groupItems.length}</span>
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
										expanded={expanded.has(item.id)}
										selected={item.id === selectedItemId}
										onToggle={toggleExpand}
										onOpen={onOpenItem}
										onSelect={onSelectItem}
										onOpenChild={onOpenChild}
									/>
								))
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
