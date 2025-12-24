import { useState, useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { useModel, EpicsCollection, type EpicModel, type Status } from '@doc-platform/models';
import { Column } from '../components/Column';
import { EpicDialog } from '../components/EpicDialog';
import styles from './Board.module.css';

const COLUMNS: { status: Status; title: string }[] = [
	{ status: 'ready', title: 'Ready' },
	{ status: 'in_progress', title: 'In Progress' },
	{ status: 'done', title: 'Done' },
];

export function Board(_props: RouteProps): JSX.Element {
	// Collection auto-fetches on construction, useModel subscribes to changes
	const epics = useMemo(() => new EpicsCollection(), []);
	useModel(epics);

	const [selectedEpicId, setSelectedEpicId] = useState<string | undefined>();
	const [dialogEpic, setDialogEpic] = useState<EpicModel | null>(null);

	function handleSelectEpic(epic: EpicModel): void {
		setSelectedEpicId(epic.id);
	}

	function handleOpenEpic(epic: EpicModel): void {
		setDialogEpic(epic);
	}

	function handleCloseDialog(): void {
		setDialogEpic(null);
	}

	function handleDeleteEpic(epic: EpicModel): void {
		epics.remove(epic);
		setDialogEpic(null);
	}

	function handleDragStart(e: DragEvent, epic: EpicModel): void {
		e.dataTransfer?.setData('text/plain', epic.id);
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
		}
	}

	function handleDragEnd(): void {
		// Drag ended
	}

	function handleDropEpic(epicId: string, newStatus: Status, dropIndex: number): void {
		const epic = epics.find((e) => e.id === epicId);
		if (!epic) return;

		// Get epics in the target column (excluding the dragged epic if same column)
		const targetColumnEpics = epics
			.filter((e) => e.status === newStatus && e.id !== epicId)
			.sort((a, b) => a.rank - b.rank);

		// Calculate new rank based on drop position
		let newRank: number;
		const firstEpic = targetColumnEpics[0];
		const lastEpic = targetColumnEpics[targetColumnEpics.length - 1];

		if (targetColumnEpics.length === 0 || !firstEpic || !lastEpic) {
			newRank = 1;
		} else if (dropIndex === 0) {
			// Before first item
			newRank = firstEpic.rank - 1;
		} else if (dropIndex >= targetColumnEpics.length) {
			// After last item
			newRank = lastEpic.rank + 1;
		} else {
			// Between two items - use midpoint
			const prevEpic = targetColumnEpics[dropIndex - 1];
			const nextEpic = targetColumnEpics[dropIndex];
			if (prevEpic && nextEpic) {
				newRank = (prevEpic.rank + nextEpic.rank) / 2;
			} else {
				newRank = dropIndex + 1;
			}
		}

		// Update epic
		epic.status = newStatus;
		epic.rank = newRank;
		epic.save();

		// If ranks get too close (fractional precision issues), normalize the column
		if (shouldNormalizeRanks(targetColumnEpics, newRank)) {
			normalizeColumnRanks(newStatus);
		}
	}

	function shouldNormalizeRanks(columnEpics: EpicModel[], newRank: number): boolean {
		// Check if any ranks are getting too close together
		const allRanks = [...columnEpics.map((e) => e.rank), newRank].sort((a, b) => a - b);
		for (let i = 1; i < allRanks.length; i++) {
			const current = allRanks[i];
			const previous = allRanks[i - 1];
			if (current !== undefined && previous !== undefined && Math.abs(current - previous) < 0.001) {
				return true;
			}
		}
		return false;
	}

	function normalizeColumnRanks(status: Status): void {
		const columnEpics = epics
			.filter((e) => e.status === status)
			.sort((a, b) => a.rank - b.rank);

		columnEpics.forEach((epic, index) => {
			epic.rank = index + 1;
			epic.save();
		});
	}

	function handleCreateEpic(): void {
		const title = prompt('Epic title:');
		if (!title) return;

		epics.add({ title, status: 'ready', rank: epics.length + 1 }); // $meta tracks state
	}

	// Loading state from collection's $meta
	if (epics.$meta.working && epics.length === 0) {
		return (
			<div class={styles.container}>
				<div class={styles.loading}>Loading...</div>
			</div>
		);
	}

	// Error state from collection's $meta
	if (epics.$meta.error) {
		return (
			<div class={styles.container}>
				<div class={styles.error}>Error: {epics.$meta.error.message}</div>
			</div>
		);
	}

	return (
		<div class={styles.container}>
			<header class={styles.header}>
				<h1 class={styles.title}>Planning Board</h1>
				<div class={styles.actions}>
					<button class={styles.button} onClick={handleCreateEpic}>
						+ New Epic
					</button>
				</div>
			</header>

			<div class={styles.board}>
				{COLUMNS.map(({ status, title }) => (
					<Column
						key={status}
						status={status}
						title={title}
						epics={epics.byStatus(status)}
						selectedEpicId={selectedEpicId}
						onSelectEpic={handleSelectEpic}
						onOpenEpic={handleOpenEpic}
						onDropEpic={handleDropEpic}
						onDragStart={handleDragStart}
						onDragEnd={handleDragEnd}
					/>
				))}
			</div>

			{dialogEpic && (
				<EpicDialog
					epic={dialogEpic}
					onClose={handleCloseDialog}
					onDelete={handleDeleteEpic}
				/>
			)}
		</div>
	);
}
