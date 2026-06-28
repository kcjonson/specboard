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

// 'blocked'/'in_review' have no dedicated StatusDot color — fall back to the neutral dot.
const DOT_STATUS: Record<ItemStatus, StatusType> = {
	ready: 'ready',
	in_progress: 'in_progress',
	blocked: 'default',
	in_review: 'default',
	done: 'done',
};

export interface ItemRowProps {
	item: ItemModel;
	expanded: boolean;
	selected: boolean;
	onToggle: (item: ItemModel) => void;
	onOpen: (item: ItemModel) => void;
	onSelect: (item: ItemModel | undefined) => void;
	/** Open a child's detail by id (children are first-class items). */
	onOpenChild?: (itemId: string) => void;
}

/**
 * A single item row in the table. Expands to reveal its children, which are lazily
 * fetched on first expand — `useModel` re-renders this row when they land.
 */
export function ItemRow({
	item,
	expanded,
	selected,
	onToggle,
	onOpen,
	onSelect,
	onOpenChild,
}: ItemRowProps): JSX.Element {
	// Subscribe so the row re-renders when fetch() populates children / flips $meta.
	useModel(item);

	const { total, done } = item.childStats;
	const hasChildren = total > 0;
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
				class={`${styles.row} ${styles.epicRow} ${selected ? styles.selected : ''}`}
				role="row"
				tabIndex={0}
				onClick={handleOpen}
				onKeyDown={(e) => {
					if (e.key === 'Enter') handleOpen();
				}}
			>
				<span class={styles.colTitle} role="cell">
					{hasChildren ? (
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
					<span class={styles.title}>{item.title}</span>
				</span>
				<span class={styles.colType} role="cell">
					<TypeBadge type={item.type} />
				</span>
				<span class={styles.colStatus} role="cell">
					<StatusDot status={DOT_STATUS[item.status]} />
					{STATUS_LABELS[item.status]}
				</span>
				<span class={styles.colTasks} role="cell">{hasChildren ? `${done}/${total}` : '—'}</span>
				<span class={styles.colAssignee} role="cell">{item.assignee || '—'}</span>
			</div>

			{expanded && loadingChildren && (
				<div class={`${styles.row} ${styles.taskRow}`} role="row">
					<span class={`${styles.colTitle} ${styles.loadingTasks}`} role="cell">Loading…</span>
				</div>
			)}

			{expanded &&
				!loadingChildren &&
				item.children.map((child) => <ChildRow key={child.id} child={child} onOpen={onOpenChild} />)}
		</>
	);
}
