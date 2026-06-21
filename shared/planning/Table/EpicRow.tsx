import type { JSX } from 'preact';
import { useModel, type ItemModel, type Status } from '@specboard/models';
import { Icon, StatusDot } from '@specboard/ui';
import { TypeBadge } from '../TypeBadge/TypeBadge';
import { TaskRow } from './TaskRow';
import styles from './Table.module.css';

const STATUS_LABELS: Record<Status, string> = {
	ready: 'Ready',
	in_progress: 'In Progress',
	done: 'Done',
};

export interface EpicRowProps {
	item: ItemModel;
	expanded: boolean;
	selected: boolean;
	onToggle: (item: ItemModel) => void;
	onOpen: (item: ItemModel) => void;
	onSelect: (item: ItemModel | undefined) => void;
}

/**
 * A single epic row in the table. Expands to reveal its task children, which are
 * lazily fetched on first expand — `useModel` re-renders this row when they land.
 */
export function EpicRow({
	item,
	expanded,
	selected,
	onToggle,
	onOpen,
	onSelect,
}: EpicRowProps): JSX.Element {
	// Subscribe so the row re-renders when fetch() populates tasks / flips $meta.
	useModel(item);

	const { total, done } = item.taskStats;
	const hasTasks = total > 0;
	const loadingTasks = item.$meta.working && item.tasks.length === 0;

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
					{hasTasks ? (
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
					<StatusDot status={item.status} />
					{STATUS_LABELS[item.status]}
				</span>
				<span class={styles.colTasks} role="cell">{hasTasks ? `${done}/${total}` : '—'}</span>
				<span class={styles.colAssignee} role="cell">{item.assignee || '—'}</span>
			</div>

			{expanded && loadingTasks && (
				<div class={`${styles.row} ${styles.taskRow}`} role="row">
					<span class={`${styles.colTitle} ${styles.loadingTasks}`} role="cell">Loading tasks…</span>
				</div>
			)}

			{expanded &&
				!loadingTasks &&
				item.tasks.map((task) => <TaskRow key={task.id} task={task} />)}
		</>
	);
}
