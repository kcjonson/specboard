import type { JSX } from 'preact';
import { useModel, type ItemModel, type ItemStatus } from '@specboard/models';
import { Icon, StatusDot, type StatusType } from '@specboard/ui';
import { TypeBadge } from '../TypeBadge/TypeBadge';
import { ChildRow } from './ChildRow';
import styles from './Table.module.css';

const STATUS_LABELS: Record<ItemStatus, string> = {
	ready: 'Ready',
	in_progress: 'In Progress',
	blocked: 'Blocked',
	in_review: 'In Review',
	done: 'Done',
};

// 'in_review' has no dedicated StatusDot color — fall back to the neutral dot.
const DOT_STATUS: Record<ItemStatus, StatusType> = {
	ready: 'ready',
	in_progress: 'in_progress',
	blocked: 'blocked',
	in_review: 'default',
	done: 'done',
};

export interface ItemRowProps {
	item: ItemModel;
	/** Whether rows may reveal their children at all (off while a filter is active). */
	expandable: boolean;
	expanded: boolean;
	selected: boolean;
	/** Briefly pulse the row (newly created, or changed by a background refresh). */
	flashing: boolean;
	onToggle: (item: ItemModel) => void;
	onOpen: (item: ItemModel) => void;
	onSelect: (item: ItemModel | undefined) => void;
	/** Open a child's detail by key (children are first-class items). */
	onOpenChild?: (itemKey: string) => void;
}

/**
 * A single item row in the table. Expands to reveal its children, which are lazily
 * fetched on first expand — `useModel` re-renders this row when they land.
 *
 * A search matches items at any depth, so this also renders child items, in the
 * section for their own status. Those carry `parentKey`, shown as a breadcrumb
 * before the title. No row expands while a filter is active (see Table): the
 * children endpoint is unfiltered, so it would duplicate the rows already matched.
 */
export function ItemRow({
	item,
	expandable,
	expanded,
	selected,
	flashing,
	onToggle,
	onOpen,
	onSelect,
	onOpenChild,
}: ItemRowProps): JSX.Element {
	// Subscribe so the row re-renders when fetch() populates children / flips $meta.
	useModel(item);

	const { total, done } = item.childStats;
	const hasChildren = total > 0;
	const canExpand = hasChildren && expandable;
	const showChildren = canExpand && expanded;
	const loadingChildren = item.$meta.working && item.children.length === 0;

	const handleToggle = (e: MouseEvent): void => {
		e.stopPropagation();
		onToggle(item);
	};

	const handleOpen = (): void => {
		onSelect(item);
		onOpen(item);
	};

	return (
		<>
			<div
				class={`${styles.row} ${styles.epicRow} ${selected ? styles.selected : ''} ${flashing ? styles.highlighted : ''}`}
				role="row"
				tabIndex={0}
				onClick={handleOpen}
				onKeyDown={(e) => {
					if (e.key === 'Enter') handleOpen();
				}}
			>
				<span class={styles.colTitle} role="cell">
					{canExpand ? (
						<button
							type="button"
							class={styles.chevron}
							onClick={handleToggle}
							aria-label={expanded ? 'Collapse' : 'Expand'}
							aria-expanded={expanded}
						>
							<Icon name={expanded ? 'chevron-down' : 'chevron-right'} class="size-sm" />
						</button>
					) : (
						<span class={styles.chevronSpacer} />
					)}
					{item.parentKey && (
						<span class={styles.parentKey} title={`Child of ${item.parentKey}`}>{item.parentKey} /</span>
					)}
					<span class={styles.itemKey}>{item.key}</span>
					<span class={styles.title}>{item.title}</span>
				</span>
				<span class={styles.colType} role="cell">
					<TypeBadge type={item.type} />
				</span>
				<span class={styles.colStatus} role="cell">
					<StatusDot status={DOT_STATUS[item.status]} />
					{STATUS_LABELS[item.status]}
					{item.blocked && item.status !== 'blocked' && (
						<span class={styles.blockedChip} title="This item has open blockers">Blocked</span>
					)}
				</span>
				<span class={styles.colTasks} role="cell">{hasChildren ? `${done}/${total}` : '—'}</span>
				<span class={styles.colAssignee} role="cell">{item.assignee || '—'}</span>
			</div>

			{showChildren && loadingChildren && (
				<div class={`${styles.row} ${styles.taskRow}`} role="row">
					<span class={`${styles.colTitle} ${styles.loadingTasks}`} role="cell">Loading…</span>
				</div>
			)}

			{showChildren &&
				!loadingChildren &&
				item.children.map((child) => <ChildRow key={child.id} child={child} onOpen={onOpenChild} />)}
		</>
	);
}
