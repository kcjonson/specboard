import type { JSX } from 'preact';
import type { EpicModel } from '@doc-platform/models';
import { Icon } from '@doc-platform/ui';
import styles from './EpicCard.module.css';

interface EpicCardProps {
	epic: EpicModel;
	projectId: string;
	isSelected?: boolean;
	isHighlighted?: boolean;
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
	projectId,
	isSelected = false,
	isHighlighted = false,
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

	const handleOpenInNewWindow = (e: MouseEvent): void => {
		e.stopPropagation();
		window.open(`/projects/${projectId}/planning/epics/${epic.id}`, '_blank', 'noopener,noreferrer');
	};

	const cardClass = [
		styles.card,
		isSelected && styles.selected,
		isHighlighted && styles.highlighted,
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
				<div class={styles.headerActions}>
					<button
						type="button"
						class={styles.openButton}
						onClick={handleOpenInNewWindow}
						aria-label="Open in new window"
						title="Open in new window"
					>
						<Icon name="external-link" />
					</button>
					{epic.assignee && (
						<div class={styles.assignee} title={epic.assignee}>
							{getInitials(epic.assignee)}
						</div>
					)}
				</div>
			</div>

			{epic.description && (
				<p class={styles.description}>{epic.description}</p>
			)}

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
				Updated {formatTimeAgo(epic.updatedAt)}
			</div>
		</div>
	);
}
