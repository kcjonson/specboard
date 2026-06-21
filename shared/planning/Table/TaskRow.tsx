import type { JSX } from 'preact';
import type { TaskModel, TaskStatus } from '@specboard/models';
import { StatusDot, type StatusType } from '@specboard/ui';
import styles from './Table.module.css';

const STATUS_LABELS: Record<TaskStatus, string> = {
	ready: 'Ready',
	in_progress: 'In Progress',
	blocked: 'Blocked',
	done: 'Done',
};

// 'blocked' has no dedicated StatusDot color — fall back to the neutral dot.
const DOT_STATUS: Record<TaskStatus, StatusType> = {
	ready: 'ready',
	in_progress: 'in_progress',
	blocked: 'default',
	done: 'done',
};

export interface TaskRowProps {
	task: TaskModel;
}

/** A task child row, indented one level under its epic. Read-only in v1. */
export function TaskRow({ task }: TaskRowProps): JSX.Element {
	return (
		<div class={`${styles.row} ${styles.taskRow}`} role="row">
			<span class={styles.colTitle} role="cell">
				<span class={styles.chevronSpacer} />
				<span class={styles.taskTitle}>{task.title}</span>
			</span>
			<span class={styles.colType} role="cell" />
			<span class={styles.colStatus} role="cell">
				<StatusDot status={DOT_STATUS[task.status]} />
				{STATUS_LABELS[task.status]}
			</span>
			<span class={styles.colTasks} role="cell" />
			<span class={styles.colAssignee} role="cell">{task.assignee || '—'}</span>
		</div>
	);
}
