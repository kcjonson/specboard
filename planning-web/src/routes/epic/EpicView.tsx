import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { useModel, EpicModel, type TaskModel, type Status } from '@doc-platform/models';
import { TaskCard } from './TaskCard';
import styles from './EpicView.module.css';

interface EpicViewProps {
	epic: EpicModel;
	onClose?: () => void;
	onDelete?: (epic: EpicModel) => void;
}

const STATUS_OPTIONS: { value: Status; label: string }[] = [
	{ value: 'ready', label: 'Ready' },
	{ value: 'in_progress', label: 'In Progress' },
	{ value: 'done', label: 'Done' },
];

export function EpicView({ epic, onClose, onDelete }: EpicViewProps): JSX.Element {
	useModel(epic);

	const [isEditingDescription, setIsEditingDescription] = useState(false);
	const [descriptionDraft, setDescriptionDraft] = useState(epic.description || '');
	const [newTaskTitle, setNewTaskTitle] = useState('');

	const taskStats = epic.taskStats;

	// Task status toggle
	const handleToggleTaskStatus = (task: TaskModel): void => {
		task.status = task.status === 'done' ? 'ready' : 'done';
		// Note: Task saving would need API integration
	};

	// Description editing
	const handleEditDescription = (): void => {
		setDescriptionDraft(epic.description || '');
		setIsEditingDescription(true);
	};

	const handleSaveDescription = (): void => {
		epic.description = descriptionDraft;
		epic.save();
		setIsEditingDescription(false);
	};

	const handleCancelDescription = (): void => {
		setIsEditingDescription(false);
	};

	// Add task
	const handleAddTask = (): void => {
		if (!newTaskTitle.trim()) return;
		// For now, create task locally - API integration needed
		// epic.tasks.add({ title: newTaskTitle.trim(), status: 'ready', rank: epic.tasks.length + 1 });
		setNewTaskTitle('');
	};

	const handleAddTaskKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Enter') {
			handleAddTask();
		} else if (e.key === 'Escape') {
			setNewTaskTitle('');
		}
	};

	// Status change
	const handleStatusChange = (e: Event): void => {
		const target = e.target as HTMLSelectElement;
		epic.status = target.value as Status;
		epic.save();
	};

	// Delete epic
	const handleDelete = (): void => {
		if (confirm('Are you sure you want to delete this epic?')) {
			onDelete?.(epic);
		}
	};

	return (
		<div class={styles.container}>
			{/* Header */}
			<div class={styles.header}>
				<h2 class={styles.title}>
					<span class={styles.titleIcon}>◆</span>
					{epic.title}
				</h2>
				{onClose && (
					<button class={styles.closeButton} onClick={onClose} aria-label="Close">
						×
					</button>
				)}
			</div>

			{/* Description */}
			<section class={styles.section}>
				<div class={styles.sectionHeader}>
					<h3 class={styles.sectionTitle}>Description</h3>
					{!isEditingDescription && (
						<button class={styles.textButton} onClick={handleEditDescription}>
							Edit
						</button>
					)}
				</div>
				{isEditingDescription ? (
					<div class={styles.descriptionEdit}>
						<textarea
							class={styles.textarea}
							value={descriptionDraft}
							onInput={(e) => setDescriptionDraft((e.target as HTMLTextAreaElement).value)}
							rows={3}
							placeholder="Add a description..."
						/>
						<div class={styles.descriptionActions}>
							<button class={styles.button} onClick={handleSaveDescription}>
								Save
							</button>
							<button class={styles.textButton} onClick={handleCancelDescription}>
								Cancel
							</button>
						</div>
					</div>
				) : (
					<p class={styles.description}>
						{epic.description || <span class={styles.placeholder}>No description</span>}
					</p>
				)}
			</section>

			{/* Tasks */}
			<section class={styles.section}>
				<div class={styles.sectionHeader}>
					<h3 class={styles.sectionTitle}>
						Tasks ({taskStats.done}/{taskStats.total})
					</h3>
				</div>
				<div class={styles.taskList} role="list">
					{epic.tasks.map((task) => (
						<TaskCard key={task.id} task={task} onToggleStatus={handleToggleTaskStatus} />
					))}
				</div>
				<div class={styles.addTask}>
					<input
						type="text"
						class={styles.addTaskInput}
						value={newTaskTitle}
						onInput={(e) => setNewTaskTitle((e.target as HTMLInputElement).value)}
						onKeyDown={handleAddTaskKeyDown}
						placeholder="Add a task..."
					/>
					<button
						class={styles.textButton}
						onClick={handleAddTask}
						disabled={!newTaskTitle.trim()}
					>
						+ Add
					</button>
				</div>
			</section>

			{/* Linked Documents (stub for now) */}
			<section class={styles.section}>
				<div class={styles.sectionHeader}>
					<h3 class={styles.sectionTitle}>Linked Documents</h3>
					<button class={styles.textButton} disabled>
						+ Link Doc
					</button>
				</div>
				<p class={styles.placeholder}>No linked documents</p>
			</section>

			{/* Controls */}
			<section class={styles.controls}>
				<div class={styles.controlGroup}>
					<label class={styles.controlLabel}>Status</label>
					<select class={styles.select} value={epic.status} onChange={handleStatusChange}>
						{STATUS_OPTIONS.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>
				</div>
				<div class={styles.controlGroup}>
					<label class={styles.controlLabel}>Assignee</label>
					<span class={styles.assigneeValue}>{epic.assignee || 'Unassigned'}</span>
				</div>
			</section>

			{/* Footer */}
			<div class={styles.footer}>
				<button class={styles.dangerButton} onClick={handleDelete}>
					Delete Epic
				</button>
			</div>
		</div>
	);
}
