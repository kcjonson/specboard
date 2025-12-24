import { useEffect, useCallback } from 'preact/hooks';
import type { EpicModel, Status } from '@doc-platform/models';

const STATUSES: Status[] = ['ready', 'in_progress', 'done'];

interface KeyboardNavigationOptions {
	/** All epics grouped by status */
	epicsByStatus: Record<Status, EpicModel[]>;
	/** Currently selected epic ID */
	selectedEpicId: string | undefined;
	/** Whether a dialog is open (disables shortcuts) */
	dialogOpen: boolean;
	/** Callback when selection changes */
	onSelectEpic: (epic: EpicModel | undefined) => void;
	/** Callback to open an epic */
	onOpenEpic: (epic: EpicModel) => void;
	/** Callback to create a new epic */
	onCreateEpic: () => void;
	/** Callback to move epic to a status */
	onMoveEpic: (epic: EpicModel, status: Status) => void;
}

export function useKeyboardNavigation({
	epicsByStatus,
	selectedEpicId,
	dialogOpen,
	onSelectEpic,
	onOpenEpic,
	onCreateEpic,
	onMoveEpic,
}: KeyboardNavigationOptions): void {
	// Find the selected epic and its position
	const findSelectedEpic = useCallback((): {
		epic: EpicModel | undefined;
		status: Status | undefined;
		index: number;
	} => {
		if (!selectedEpicId) {
			return { epic: undefined, status: undefined, index: -1 };
		}

		for (const status of STATUSES) {
			const epics = epicsByStatus[status];
			const index = epics.findIndex((e) => e.id === selectedEpicId);
			if (index !== -1) {
				return { epic: epics[index], status, index };
			}
		}

		return { epic: undefined, status: undefined, index: -1 };
	}, [selectedEpicId, epicsByStatus]);

	// Navigate up/down within a column
	const navigateVertical = useCallback(
		(direction: 'up' | 'down') => {
			const { status, index } = findSelectedEpic();

			if (!status) {
				// No selection, select first epic in first non-empty column
				for (const s of STATUSES) {
					const epics = epicsByStatus[s];
					if (epics.length > 0) {
						onSelectEpic(epics[0]);
						return;
					}
				}
				return;
			}

			const epics = epicsByStatus[status];
			const newIndex = direction === 'up' ? index - 1 : index + 1;

			if (newIndex >= 0 && newIndex < epics.length) {
				onSelectEpic(epics[newIndex]);
			}
		},
		[findSelectedEpic, epicsByStatus, onSelectEpic]
	);

	// Navigate left/right between columns
	const navigateHorizontal = useCallback(
		(direction: 'left' | 'right') => {
			const { status, index } = findSelectedEpic();

			if (!status) {
				// No selection, select first epic in first/last non-empty column
				const statuses = direction === 'left' ? [...STATUSES].reverse() : STATUSES;
				for (const s of statuses) {
					const epics = epicsByStatus[s];
					if (epics.length > 0) {
						onSelectEpic(epics[0]);
						return;
					}
				}
				return;
			}

			const currentStatusIndex = STATUSES.indexOf(status);
			const newStatusIndex =
				direction === 'left' ? currentStatusIndex - 1 : currentStatusIndex + 1;

			if (newStatusIndex >= 0 && newStatusIndex < STATUSES.length) {
				const newStatus = STATUSES[newStatusIndex];
				if (newStatus) {
					const newColumnEpics = epicsByStatus[newStatus];
					if (newColumnEpics.length > 0) {
						// Try to maintain similar position, or go to last item
						const newIndex = Math.min(index, newColumnEpics.length - 1);
						onSelectEpic(newColumnEpics[newIndex]);
					}
				}
			}
		},
		[findSelectedEpic, epicsByStatus, onSelectEpic]
	);

	// Move selected epic to a status
	const moveToStatus = useCallback(
		(targetStatus: Status) => {
			const { epic } = findSelectedEpic();
			if (epic && epic.status !== targetStatus) {
				onMoveEpic(epic, targetStatus);
			}
		},
		[findSelectedEpic, onMoveEpic]
	);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			// Don't handle if dialog is open or if typing in an input
			if (dialogOpen) return;

			const target = e.target as HTMLElement;
			const isInput =
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable;

			if (isInput) return;

			const { epic } = findSelectedEpic();

			switch (e.key) {
				case 'ArrowUp':
					e.preventDefault();
					navigateVertical('up');
					break;

				case 'ArrowDown':
					e.preventDefault();
					navigateVertical('down');
					break;

				case 'ArrowLeft':
					e.preventDefault();
					navigateHorizontal('left');
					break;

				case 'ArrowRight':
					e.preventDefault();
					navigateHorizontal('right');
					break;

				case 'Enter':
					if (epic) {
						e.preventDefault();
						onOpenEpic(epic);
					}
					break;

				case 'Escape':
					e.preventDefault();
					onSelectEpic(undefined);
					break;

				case 'n':
				case 'N':
					e.preventDefault();
					onCreateEpic();
					break;

				case '1':
					if (epic) {
						e.preventDefault();
						moveToStatus('ready');
					}
					break;

				case '2':
					if (epic) {
						e.preventDefault();
						moveToStatus('in_progress');
					}
					break;

				case '3':
					if (epic) {
						e.preventDefault();
						moveToStatus('done');
					}
					break;
			}
		},
		[
			dialogOpen,
			findSelectedEpic,
			navigateVertical,
			navigateHorizontal,
			onSelectEpic,
			onOpenEpic,
			onCreateEpic,
			moveToStatus,
		]
	);

	useEffect(() => {
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [handleKeyDown]);
}
