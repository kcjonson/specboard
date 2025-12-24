import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Epic, Status } from '@doc-platform/core';
import { EpicCard } from './EpicCard';
import styles from './Column.module.css';

interface ColumnProps {
	status: Status;
	title: string;
	epics: Epic[];
	selectedEpicId?: string;
	onSelectEpic?: (epic: Epic) => void;
	onOpenEpic?: (epic: Epic) => void;
	onDropEpic?: (epicId: string, status: Status, index: number) => void;
	onDragStart?: (e: DragEvent, epic: Epic) => void;
	onDragEnd?: (e: DragEvent) => void;
}

const STATUS_LABELS: Record<Status, string> = {
	ready: 'Ready',
	in_progress: 'In Progress',
	done: 'Done',
};

const STATUS_CLASSES: Record<Status, string> = {
	ready: styles.ready ?? '',
	in_progress: styles.inProgress ?? '',
	done: styles.done ?? '',
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

	const handleDragOver = (e: DragEvent): void => {
		e.preventDefault();
		setIsDragOver(true);
	};

	const handleDragLeave = (): void => {
		setIsDragOver(false);
	};

	const handleDrop = (e: DragEvent): void => {
		e.preventDefault();
		setIsDragOver(false);

		const epicId = e.dataTransfer?.getData('text/plain');
		if (epicId && onDropEpic) {
			onDropEpic(epicId, status, epics.length);
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
					<span class={`${styles.statusDot} ${STATUS_CLASSES[status]}`} />
					{STATUS_LABELS[status]}
				</h2>
				<span class={styles.count}>{epics.length}</span>
			</div>

			<div class={styles.content}>
				<div
					class={dropZoneClass}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
				>
					{epics.length === 0 ? (
						<div class={styles.empty}>No epics</div>
					) : (
						epics.map((epic) => (
							<EpicCard
								key={epic.id}
								epic={epic}
								isSelected={epic.id === selectedEpicId}
								onSelect={onSelectEpic}
								onOpen={onOpenEpic}
								onDragStart={onDragStart}
								onDragEnd={onDragEnd}
							/>
						))
					)}
				</div>
			</div>
		</div>
	);
}
