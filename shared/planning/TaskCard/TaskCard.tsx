import type { JSX } from 'preact';
import type { ChildModel } from '@specboard/models';
import { Icon } from '@specboard/ui';
import styles from './TaskCard.module.css';

interface TaskCardProps {
	task: ChildModel;
	onToggleStatus?: (task: ChildModel) => void;
	/** Open this child's detail (children are first-class items). */
	onOpen?: (task: ChildModel) => void;
}

export function TaskCard({ task, onToggleStatus, onOpen }: TaskCardProps): JSX.Element {
	const isDone = task.status === 'done';

	// The checkbox toggles done; clicking elsewhere on the card opens the child.
	const handleCheckboxClick = (e: MouseEvent): void => {
		e.stopPropagation();
		onToggleStatus?.(task);
	};

	const handleOpen = (): void => onOpen?.(task);

	const handleKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Enter') {
			e.preventDefault();
			onOpen?.(task);
		}
	};

	const cardClass = [styles.card, isDone && styles.done].filter(Boolean).join(' ');

	return (
		<div class={cardClass} onClick={handleOpen} onKeyDown={handleKeyDown} tabIndex={0} role="listitem">
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
				</div>
			</div>
		</div>
	);
}
