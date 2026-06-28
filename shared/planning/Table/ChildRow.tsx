import type { JSX } from 'preact';
import type { ChildModel, ItemStatus } from '@specboard/models';
import { StatusDot, type StatusType } from '@specboard/ui';
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

export interface ChildRowProps {
	child: ChildModel;
	/** Open this child's detail (children are first-class items). */
	onOpen?: (itemId: string) => void;
}

/** A child item row, indented one level under its parent. Clickable to open its detail. */
export function ChildRow({ child, onOpen }: ChildRowProps): JSX.Element {
	const handleOpen = (): void => onOpen?.(child.id);
	return (
		<div
			class={`${styles.row} ${styles.taskRow} ${styles.clickable}`}
			role="row"
			tabIndex={0}
			onClick={handleOpen}
			onKeyDown={(e) => {
				if (e.key === 'Enter') handleOpen();
			}}
		>
			<span class={styles.colTitle} role="cell">
				<span class={styles.chevronSpacer} />
				<span class={styles.taskTitle}>{child.title}</span>
			</span>
			<span class={styles.colType} role="cell" />
			<span class={styles.colStatus} role="cell">
				<StatusDot status={DOT_STATUS[child.status]} />
				{STATUS_LABELS[child.status]}
			</span>
			<span class={styles.colTasks} role="cell" />
			<span class={styles.colAssignee} role="cell" />
		</div>
	);
}
