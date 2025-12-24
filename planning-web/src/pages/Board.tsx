import { useState, useEffect, useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import type { RouteProps } from '@doc-platform/router';
import { navigate } from '@doc-platform/router';
import { useModel, createEpicsCollection, type EpicModel, type Status } from '@doc-platform/models';
import { Column } from '../components/Column';
import styles from './Board.module.css';

const API_BASE = 'http://localhost:3001';

const COLUMNS: { status: Status; title: string }[] = [
	{ status: 'ready', title: 'Ready' },
	{ status: 'in_progress', title: 'In Progress' },
	{ status: 'done', title: 'Done' },
];

export function Board(_props: RouteProps): JSX.Element {
	// Create collection once, subscribe to changes with useModel
	const epics = useMemo(() => createEpicsCollection(), []);
	useModel(epics);

	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedEpicId, setSelectedEpicId] = useState<string | undefined>();

	useEffect(() => {
		fetchEpics();
	}, []);

	async function fetchEpics(): Promise<void> {
		try {
			setLoading(true);
			const res = await fetch(`${API_BASE}/api/epics`);
			if (!res.ok) throw new Error('Failed to fetch epics');
			const data = await res.json();
			// Populate collection with fetched data
			epics.clear(data);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Unknown error');
		} finally {
			setLoading(false);
		}
	}

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
		// Drag ended - could add visual feedback here
	}

	async function handleDropEpic(epicId: string, newStatus: Status, _index: number): Promise<void> {
		// Find the epic and update optimistically
		const epic = epics.find((e) => e.id === epicId);
		if (!epic) return;

		const oldStatus = epic.status;
		epic.status = newStatus; // Triggers change event via Model

		try {
			const res = await fetch(`${API_BASE}/api/epics/${epicId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: newStatus }),
			});
			if (!res.ok) throw new Error('Failed to update epic');
		} catch (err) {
			// Revert on error
			epic.status = oldStatus;
			console.error('Failed to move epic:', err);
		}
	}

	async function handleCreateEpic(): Promise<void> {
		const title = prompt('Epic title:');
		if (!title) return;

		try {
			const res = await fetch(`${API_BASE}/api/epics`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title }),
			});
			if (!res.ok) throw new Error('Failed to create epic');
			const newEpic = await res.json();
			// Add to collection (triggers change event)
			epics.add(newEpic);
		} catch (err) {
			console.error('Failed to create epic:', err);
		}
	}

	if (loading) {
		return (
			<div class={styles.container}>
				<div class={styles.loading}>Loading...</div>
			</div>
		);
	}

	if (error) {
		return (
			<div class={styles.container}>
				<div class={styles.error}>Error: {error}</div>
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
