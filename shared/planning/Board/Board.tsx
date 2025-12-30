import { useState, useMemo, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { navigate } from '@doc-platform/router';
import { useModel, EpicsCollection, type EpicModel, type Status } from '@doc-platform/models';
import { Button, Page } from '@doc-platform/ui';
import { Column } from '../Column/Column';
import { EpicDialog } from '../EpicDialog/EpicDialog';
import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';
import styles from './Board.module.css';

const COLUMNS: { status: Status; title: string }[] = [
	{ status: 'ready', title: 'Ready' },
	{ status: 'in_progress', title: 'In Progress' },
	{ status: 'done', title: 'Done' },
];

export function Board(props: RouteProps): JSX.Element {
	const projectId = props.params.projectId || 'demo';

	// Collection auto-fetches after projectId is set
	const epics = useMemo(() => new EpicsCollection({ projectId }), [projectId]);
	useModel(epics);

	const [selectedEpicId, setSelectedEpicId] = useState<string | undefined>();
	const [dialogEpic, setDialogEpic] = useState<EpicModel | null>(null);
	const [isNewEpicDialogOpen, setIsNewEpicDialogOpen] = useState(false);

	// Memoize epics by status for keyboard navigation
	const epicsByStatus = useMemo(
		() => ({
			ready: epics.byStatus('ready'),
			in_progress: epics.byStatus('in_progress'),
			done: epics.byStatus('done'),
		}),
		[epics]
	);

	const handleSelectEpic = useCallback((epic: EpicModel | undefined): void => {
		setSelectedEpicId(epic?.id);
	}, []);

	// Wrapper for Column component (which only passes EpicModel, not undefined)
	const handleColumnSelectEpic = useCallback((epic: EpicModel): void => {
		handleSelectEpic(epic);
	}, [handleSelectEpic]);

	const handleOpenEpic = useCallback((epic: EpicModel): void => {
		setDialogEpic(epic);
	}, []);

	const handleMoveEpic = useCallback(
		(epic: EpicModel, status: Status): void => {
			epic.status = status;
			epic.rank = epics.byStatus(status).length + 1;
			epic.save();
		},
		[epics]
	);

	const handleOpenNewEpicDialog = useCallback((): void => {
		setIsNewEpicDialogOpen(true);
	}, []);

	const handleCreateEpic = useCallback(
		(data: { title: string; description?: string; status: Status }): void => {
			epics.add({ ...data, rank: epics.length + 1 });
			setIsNewEpicDialogOpen(false);
		},
		[epics]
	);

	const handleCloseNewEpicDialog = useCallback((): void => {
		setIsNewEpicDialogOpen(false);
	}, []);

	// Keyboard navigation hook
	useKeyboardNavigation({
		epicsByStatus,
		selectedEpicId,
		dialogOpen: dialogEpic !== null || isNewEpicDialogOpen,
		onSelectEpic: handleSelectEpic,
		onOpenEpic: handleOpenEpic,
		onCreateEpic: handleOpenNewEpicDialog,
		onMoveEpic: handleMoveEpic,
	});

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

	// Loading state
	if (epics.$meta.working && epics.length === 0) {
		return (
			<Page projectId={projectId} activeTab="Planning">
				<div class={styles.loading}>Loading...</div>
			</Page>
		);
	}

	// Error state from collection's $meta
	if (epics.$meta.error) {
		return (
			<Page projectId={projectId} activeTab="Planning">
				<div class={styles.error}>Error: {epics.$meta.error.message}</div>
			</Page>
		);
	}

	return (
		<Page projectId={projectId} activeTab="Planning">
			<div class={styles.toolbar}>
				<Button onClick={handleOpenNewEpicDialog}>+ New Epic</Button>
			</div>

			<div class={styles.board}>
				{COLUMNS.map(({ status, title }) => (
					<Column
						key={status}
						status={status}
						title={title}
						epics={epics.byStatus(status)}
						selectedEpicId={selectedEpicId}
						onSelectEpic={handleColumnSelectEpic}
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

			{isNewEpicDialogOpen && (
				<EpicDialog
					isNew
					onClose={handleCloseNewEpicDialog}
					onCreate={handleCreateEpic}
				/>
			)}
		</Page>
	);
}
