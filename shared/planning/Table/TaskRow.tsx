import type { JSX } from 'preact';
import type { TaskModel } from '@specboard/models';
import { StatusDot, type StatusType } from '@specboard/ui';
import styles from './Table.module.css';

// Tasks can additionally be 'blocked' (allowed by the API but not in the
// TaskModel.status type), so map by raw string and fall back gracefully.
const STATUS_LABELS: Record<string, string> = {
	ready: 'Ready',
	in_progress: 'In Progress',
	blocked: 'Blocked',
	done: 'Done',
};

const DOT_STATUS: Record<string, StatusType> = {
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
	const status = task.status as string;
	return (
		<div class={`${styles.row} ${styles.taskRow}`} role="row">
			<span class={styles.colTitle}>
				<span class={styles.chevronSpacer} />
				<span class={styles.taskTitle}>{task.title}</span>
			</span>
			<span class={styles.colType} />
			<span class={styles.colStatus}>
				<StatusDot status={DOT_STATUS[status] ?? 'default'} />
				{STATUS_LABELS[status] ?? status}
			</span>
			<span class={styles.colTasks} />
			<span class={styles.colAssignee}>{task.assignee || '—'}</span>
		</div>
	);
}
