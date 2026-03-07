import { useState, useRef, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Status, ItemModel } from '@specboard/models';
import { StatusDot } from '@specboard/ui';
import { ItemCard } from '../ItemCard/ItemCard';
import styles from './Column.module.css';

interface ColumnProps {
	status: Status;
	title: string;
	items: ItemModel[];
	projectId: string;
	selectedItemId?: string;
	highlightedItemId?: string;
	onSelectItem?: (item: ItemModel) => void;
	onOpenItem?: (item: ItemModel) => void;
	onDropItem?: (itemId: string, status: Status, index: number) => void;
	onDragStart?: (e: DragEvent, item: ItemModel) => void;
	onDragEnd?: (e: DragEvent) => void;
}

const STATUS_LABELS: Record<Status, string> = {
	ready: 'Ready',
	in_progress: 'In Progress',
	done: 'Done',
};

export function Column({
	status,
	title,
	items,
	projectId,
	selectedItemId,
	highlightedItemId,
	onSelectItem,
	onOpenItem,
	onDropItem,
	onDragStart,
	onDragEnd,
}: ColumnProps): JSX.Element {
	const [isDragOver, setIsDragOver] = useState(false);
	const [dropIndex, setDropIndex] = useState<number | null>(null);
	const dropZoneRef = useRef<HTMLDivElement>(null);

	// Calculate drop index based on mouse position
	const calculateDropIndex = useCallback((e: DragEvent): number => {
		if (!dropZoneRef.current) return items.length;

		const cards = dropZoneRef.current.querySelectorAll('[data-item-card]');
		if (cards.length === 0) return 0;

		const mouseY = e.clientY;

		for (let i = 0; i < cards.length; i++) {
			const card = cards[i] as HTMLElement;
			const rect = card.getBoundingClientRect();
			const cardMiddle = rect.top + rect.height / 2;

			if (mouseY < cardMiddle) {
				return i;
			}
		}

		return items.length;
	}, [items.length]);

	const handleDragOver = (e: DragEvent): void => {
		e.preventDefault();
		setIsDragOver(true);
		setDropIndex(calculateDropIndex(e));
	};

	const handleDragLeave = (e: DragEvent): void => {
		// Only clear if we're leaving the drop zone entirely
		const relatedTarget = e.relatedTarget as Node | null;
		if (!dropZoneRef.current?.contains(relatedTarget)) {
			setIsDragOver(false);
			setDropIndex(null);
		}
	};

	const handleDrop = (e: DragEvent): void => {
		e.preventDefault();
		setIsDragOver(false);

		const itemId = e.dataTransfer?.getData('text/plain');
		const index = dropIndex ?? items.length;
		setDropIndex(null);

		if (itemId && onDropItem) {
			onDropItem(itemId, status, index);
		}
	};

	const dropZoneClass = [
		styles.dropZone,
		isDragOver && styles.dragOver,
	].filter(Boolean).join(' ');

	return (
		<div class={styles.column} role="listbox" aria-label={`${title} column`}>
			<div class={styles.header}>
				<h2 class={styles.title}>
					<StatusDot status={status} />
					{STATUS_LABELS[status]}
				</h2>
				<span class={styles.count}>{items.length}</span>
			</div>

			<div class={styles.content}>
				<div
					ref={dropZoneRef}
					class={dropZoneClass}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
				>
					{items.length === 0 ? (
						<div class={styles.empty}>No items</div>
					) : (
						items.map((item, index) => (
							<div key={item.id} class={styles.cardWrapper}>
								{isDragOver && dropIndex === index && (
									<div class={styles.dropIndicator} />
								)}
								<ItemCard
									item={item}
									projectId={projectId}
									isSelected={item.id === selectedItemId}
									isHighlighted={item.id === highlightedItemId}
									onSelect={onSelectItem}
									onOpen={onOpenItem}
									onDragStart={onDragStart}
									onDragEnd={onDragEnd}
								/>
							</div>
						))
					)}
					{isDragOver && dropIndex === items.length && items.length > 0 && (
						<div class={styles.dropIndicator} />
					)}
				</div>
			</div>
		</div>
	);
}
