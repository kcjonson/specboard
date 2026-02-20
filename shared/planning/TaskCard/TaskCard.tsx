import type { JSX } from 'preact';
import type { TaskModel } from '@specboard/models';
import { Icon } from '@specboard/ui';
import styles from './TaskCard.module.css';

interface TaskCardProps {
	task: TaskModel;
	onToggleStatus?: (task: TaskModel) => void;
}

function formatDueDate(dateString: string | undefined): string | null {
	if (!dateString) return null;
	const date = new Date(dateString);
	return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getInitials(name: string): string {
	return name
		.split(/\s+/)
		.map((part) => part[0])
		.join('')
		.toUpperCase()
		.slice(0, 2);
}

export function TaskCard({ task, onToggleStatus }: TaskCardProps): JSX.Element {
	const isDone = task.status === 'done';
	const dueDate = formatDueDate(task.dueDate);

	const handleCheckboxClick = (e: MouseEvent): void => {
		e.stopPropagation();
		onToggleStatus?.(task);
	};

	const handleKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onToggleStatus?.(task);
		}
	};

	const cardClass = [styles.card, isDone && styles.done].filter(Boolean).join(' ');

	return (
		<div class={cardClass} onKeyDown={handleKeyDown} tabIndex={0} role="listitem">
			<div class={styles.content}>
				<button
					class={styles.checkbox}
					onClick={handleCheckboxClick}
					aria-label={isDone ? 'Mark as incomplete' : 'Mark as complete'}
				>
					<Icon name={isDone ? 'checkbox-checked' : 'checkbox-unchecked'} />
				</button>
				<div class={styles.details}>
					<span class={styles.title}>{task.title}</span>
					{dueDate && <span class={styles.dueDate}>Due: {dueDate}</span>}
				</div>
			</div>
			{task.assignee && (
				<div class={styles.assignee} title={task.assignee}>
					{getInitials(task.assignee)}
				</div>
			)}
		</div>
	);
}
