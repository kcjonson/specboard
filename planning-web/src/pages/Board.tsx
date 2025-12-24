import { useState, useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { navigate } from '@doc-platform/router';
import { useModel, EpicsCollection, type EpicModel, type Status } from '@doc-platform/models';
import { Column } from '../components/Column';
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

	function getEpicsByStatus(status: Status): EpicModel[] {
		return epics
			.filter((e) => e.status === status)
			.sort((a, b) => a.rank - b.rank);
	}

	function handleSelectEpic(epic: EpicModel): void {
		setSelectedEpicId(epic.id);
	}

	function handleOpenEpic(epic: EpicModel): void {
		navigate(`/epics/${epic.id}`);
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

	function handleDropEpic(epicId: string, newStatus: Status, _index: number): void {
		const epic = epics.find((e) => e.id === epicId);
		if (!epic) return;

		epic.status = newStatus;
		epic.save(); // SyncModel handles the PUT, $meta tracks state
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
						epics={getEpicsByStatus(status)}
						selectedEpicId={selectedEpicId}
						onSelectEpic={handleSelectEpic}
						onOpenEpic={handleOpenEpic}
						onDropEpic={handleDropEpic}
						onDragStart={handleDragStart}
						onDragEnd={handleDragEnd}
					/>
				))}
			</div>
		</div>
	);
}
