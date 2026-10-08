import type { JSX } from 'preact';
import type { ItemModel, SubStatus } from '@specboard/models';
import { Avatar, Icon } from '@specboard/ui';
import { TypeBadge } from '../TypeBadge/TypeBadge';
import { ProjectChip, type ProjectLabel } from '../ProjectChip/ProjectChip';
import { formatTimeAgo } from '../utils/time';
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
	/** The item's project, on a board that mixes projects. */
	project?: ProjectLabel;
	isSelected?: boolean;
	isHighlighted?: boolean;
	/** Whether the card can be dragged to rank it. Off for a child row (see Column). */
	draggable?: boolean;
	onSelect?: (item: ItemModel) => void;
	onOpen?: (item: ItemModel) => void;
	onDragStart?: (e: DragEvent, item: ItemModel) => void;
}

export function ItemCard({
	item,
	project,
	isSelected = false,
	isHighlighted = false,
	draggable = true,
	onSelect,
	onOpen,
	onDragStart,
}: ItemCardProps): JSX.Element {
	const childStats = item.childStats;
	const progressPercent = childStats.total > 0 ? (childStats.done / childStats.total) * 100 : 0;
	const subStatusLabel = item.subStatus ? SUB_STATUS_LABELS[item.subStatus] : undefined;

	// A single click selects the card and opens it in the detail drawer.
	const handleClick = (): void => {
		onSelect?.(item);
		onOpen?.(item);
	};

	// The card's own Enter, not one bubbling from its new-window button or PR link, which Enter activates.
	const handleKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Enter' && e.target === e.currentTarget) {
			onOpen?.(item);
		}
	};

	const handleDragStart = (e: DragEvent): void => {
		onDragStart?.(e, item);
	};

	const handleOpenInNewWindow = (e: MouseEvent): void => {
		e.stopPropagation();
		window.open(`/projects/${item.projectRef}/items/${item.key}`, '_blank', 'noopener,noreferrer');
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
			data-item-key={item.key}
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			onDragStart={draggable ? handleDragStart : undefined}
			draggable={draggable}
			tabIndex={0}
			role="option"
			aria-selected={isSelected}
		>
			<div class={styles.header}>
				<div class={styles.titleRow}>
					<TypeBadge type={item.type} />
					{/* Set on a child item a search turned up: says where the card lives. */}
					{item.parentKey && (
						<span class={styles.parentKey} title={`Child of ${item.parentKey}`}>{item.parentKey} /</span>
					)}
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
					{item.assignee && <Avatar name={item.assignee} size="sm" tone="muted" />}
				</div>
			</div>

			{item.description && (
				<p class={styles.description}>{item.description}</p>
			)}

			{childStats.total > 0 && (
				<div class={styles.progress}>
					<div class={styles.progressBar}>
						<div
							class={styles.progressFill}
							style={{ width: `${progressPercent}%` }}
						/>
					</div>
					<div class={styles.progressText}>
						{childStats.done}/{childStats.total} children
						{childStats.blocked > 0 && ` · ${childStats.blocked} blocked`}
					</div>
				</div>
			)}

			<div class={project ? `${styles.footer} ${styles.footerWraps}` : styles.footer}>
				<span class={styles.itemKey}>{item.key}</span>
				{project && <ProjectChip project={project} />}
				{/* Redundant inside the Blocked column, where status alone put the card. */}
				{item.blocked && item.status !== 'blocked' && (
					<span class={styles.blockedChip} title="This item is blocked">
						Blocked
					</span>
				)}
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
