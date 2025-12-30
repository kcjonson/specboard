import { useState, useRef, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Status, EpicModel } from '@doc-platform/models';
import { StatusDot } from '@doc-platform/ui';
import { EpicCard } from '../EpicCard/EpicCard';
import styles from './Column.module.css';

interface ColumnProps {
	status: Status;
	title: string;
	epics: EpicModel[];
	selectedEpicId?: string;
	onSelectEpic?: (epic: EpicModel) => void;
	onOpenEpic?: (epic: EpicModel) => void;
	onDropEpic?: (epicId: string, status: Status, index: number) => void;
	onDragStart?: (e: DragEvent, epic: EpicModel) => void;
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
	epics,
	selectedEpicId,
	onSelectEpic,
	onOpenEpic,
	onDropEpic,
	onDragStart,
	onDragEnd,
}: ColumnProps): JSX.Element {
	const [isDragOver, setIsDragOver] = useState(false);
	const [dropIndex, setDropIndex] = useState<number | null>(null);
	const dropZoneRef = useRef<HTMLDivElement>(null);

	// Calculate drop index based on mouse position
	const calculateDropIndex = useCallback((e: DragEvent): number => {
		if (!dropZoneRef.current) return epics.length;

		const cards = dropZoneRef.current.querySelectorAll('[data-epic-card]');
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

		return epics.length;
	}, [epics.length]);

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

		const epicId = e.dataTransfer?.getData('text/plain');
		const index = dropIndex ?? epics.length;
		setDropIndex(null);

		if (epicId && onDropEpic) {
			onDropEpic(epicId, status, index);
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
				<span class={styles.count}>{epics.length}</span>
			</div>

			<div class={styles.content}>
				<div
					ref={dropZoneRef}
					class={dropZoneClass}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
				>
					{epics.length === 0 ? (
						<div class={styles.empty}>No epics</div>
					) : (
						epics.map((epic, index) => (
							<div key={epic.id} class={styles.cardWrapper}>
								{isDragOver && dropIndex === index && (
									<div class={styles.dropIndicator} />
								)}
								<EpicCard
									epic={epic}
									isSelected={epic.id === selectedEpicId}
									onSelect={onSelectEpic}
									onOpen={onOpenEpic}
									onDragStart={onDragStart}
									onDragEnd={onDragEnd}
								/>
							</div>
						))
					)}
					{isDragOver && dropIndex === epics.length && epics.length > 0 && (
						<div class={styles.dropIndicator} />
					)}
				</div>
			</div>
		</div>
	);
}
