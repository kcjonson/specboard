import type { JSX } from 'preact';
import type { EpicModel } from '@doc-platform/models';
import styles from './EpicCard.module.css';

interface EpicCardProps {
	epic: EpicModel;
	isSelected?: boolean;
	onSelect?: (epic: EpicModel) => void;
	onOpen?: (epic: EpicModel) => void;
	onDragStart?: (e: DragEvent, epic: EpicModel) => void;
	onDragEnd?: (e: DragEvent) => void;
}

function getInitials(name: string): string {
	return name
		.split(/\s+/)
		.map((part) => part[0])
		.join('')
		.toUpperCase()
		.slice(0, 2);
}

function formatTimeAgo(dateString: string): string {
	const date = new Date(dateString);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
	const diffDays = Math.floor(diffHours / 24);

	if (diffDays > 0) {
		return `${diffDays}d ago`;
	}
	if (diffHours > 0) {
		return `${diffHours}h ago`;
	}
	return 'just now';
}

export function EpicCard({
	epic,
	isSelected = false,
	onSelect,
	onOpen,
	onDragStart,
	onDragEnd,
}: EpicCardProps): JSX.Element {
	const taskStats = epic.taskStats;
	const progressPercent = taskStats.total > 0 ? (taskStats.done / taskStats.total) * 100 : 0;

	const handleClick = (): void => {
		onSelect?.(epic);
	};

	const handleDoubleClick = (): void => {
		onOpen?.(epic);
	};

	const handleKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Enter') {
			onOpen?.(epic);
		}
	};

	const handleDragStart = (e: DragEvent): void => {
		onDragStart?.(e, epic);
	};

	const cardClass = [
		styles.card,
		isSelected && styles.selected,
	].filter(Boolean).join(' ');

	return (
		<div
			class={cardClass}
			data-epic-card
			onClick={handleClick}
			onDblClick={handleDoubleClick}
			onKeyDown={handleKeyDown}
			onDragStart={handleDragStart}
			onDragEnd={onDragEnd}
			draggable
			tabIndex={0}
			role="option"
			aria-selected={isSelected}
		>
			<div class={styles.header}>
				<h3 class={styles.title}>{epic.title}</h3>
				{epic.assignee && (
					<div class={styles.assignee} title={epic.assignee}>
						{getInitials(epic.assignee)}
					</div>
				)}
			</div>

			{taskStats.total > 0 && (
				<div class={styles.progress}>
					<div class={styles.progressBar}>
						<div
							class={styles.progressFill}
							style={{ width: `${progressPercent}%` }}
						/>
					</div>
					<div class={styles.progressText}>
						{taskStats.done}/{taskStats.total} tasks
					</div>
				</div>
			)}

			<div class={styles.footer}>
				<span class={styles.id}>#{epic.id}</span>
				<span>·</span>
				<span>Updated {formatTimeAgo(epic.updatedAt)}</span>
			</div>
		</div>
	);
}
