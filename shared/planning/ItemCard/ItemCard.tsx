import type { JSX } from 'preact';
import type { ItemModel, SubStatus } from '@specboard/models';
import { Icon } from '@specboard/ui';
import { TypeBadge } from '../TypeBadge/TypeBadge';
import styles from './ItemCard.module.css';

const SUB_STATUS_LABELS: Partial<Record<SubStatus, string>> = {
	scoping: 'Scoping',
	in_development: 'In Dev',
	paused: 'Paused',
	needs_input: 'Needs Input',
	pr_open: 'PR Open',
};

interface ItemCardProps {
	item: ItemModel;
	projectId: string;
	isSelected?: boolean;
	isHighlighted?: boolean;
	onSelect?: (item: ItemModel) => void;
	onOpen?: (item: ItemModel) => void;
	onDragStart?: (e: DragEvent, item: ItemModel) => void;
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

export function ItemCard({
	item,
	projectId,
	isSelected = false,
	isHighlighted = false,
	onSelect,
	onOpen,
	onDragStart,
	onDragEnd,
}: ItemCardProps): JSX.Element {
	const taskStats = item.taskStats;
	const progressPercent = taskStats.total > 0 ? (taskStats.done / taskStats.total) * 100 : 0;
	const subStatusLabel = SUB_STATUS_LABELS[item.subStatus];

	const handleClick = (): void => {
		onSelect?.(item);
	};

	const handleDoubleClick = (): void => {
		onOpen?.(item);
	};

	const handleKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Enter') {
			onOpen?.(item);
		}
	};

	const handleDragStart = (e: DragEvent): void => {
		onDragStart?.(e, item);
	};

	const handleOpenInNewWindow = (e: MouseEvent): void => {
		e.stopPropagation();
		window.open(`/projects/${projectId}/planning/items/${item.id}`, '_blank', 'noopener,noreferrer');
	};

	const cardClass = [
		styles.card,
		isSelected && styles.selected,
		isHighlighted && styles.highlighted,
	].filter(Boolean).join(' ');

	return (
		<div
			class={cardClass}
			data-item-card
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
				<div class={styles.titleRow}>
					<TypeBadge type={item.type} />
					<h3 class={styles.title}>{item.title}</h3>
				</div>
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
					{item.assignee && (
						<div class={styles.assignee} title={item.assignee}>
							{getInitials(item.assignee)}
						</div>
					)}
				</div>
			</div>

			{item.description && (
				<p class={styles.description}>{item.description}</p>
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
				{subStatusLabel && (
					<span class={`${styles.subStatus} ${styles[`subStatus_${item.subStatus}`] || ''}`}>
						{subStatusLabel}
					</span>
				)}
				{item.prUrl && (
					<a
						class={styles.prLink}
						href={item.prUrl}
						target="_blank"
						rel="noopener noreferrer"
						onClick={(e: MouseEvent) => e.stopPropagation()}
						title="Open pull request"
					>
						<Icon name="external-link" />
						PR
					</a>
				)}
				<span class={styles.updated}>
					Updated {formatTimeAgo(item.updatedAt)}
				</span>
			</div>
		</div>
	);
}
