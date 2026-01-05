import { useState, useMemo, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Descendant } from 'slate';
import { useModel, EpicModel, type TaskModel, type Status } from '@doc-platform/models';
import { Button, Select, Text } from '@doc-platform/ui';
import { TaskCard } from '../TaskCard/TaskCard';
import { RichTextEditor, serializeToText, deserializeFromText } from '../RichTextEditor';
import styles from './EpicView.module.css';

/** Props for viewing/editing an existing epic */
interface EpicViewExistingProps {
	epic: EpicModel;
	isNew?: false;
	onDelete?: (epic: EpicModel) => void;
	onCreate?: never;
}

/** Props for creating a new epic */
interface EpicViewCreateProps {
	epic?: never;
	isNew: true;
	onDelete?: never;
	onCreate: (data: { title: string; description?: string; status: Status }) => void;
}

export type EpicViewProps = EpicViewExistingProps | EpicViewCreateProps;

const STATUS_OPTIONS: { value: Status; label: string }[] = [
	{ value: 'ready', label: 'Ready' },
	{ value: 'in_progress', label: 'In Progress' },
	{ value: 'done', label: 'Done' },
];

export function EpicView(props: EpicViewProps): JSX.Element {
	const { isNew = false } = props;
	const epic = isNew ? undefined : props.epic;
	const onDelete = isNew ? undefined : props.onDelete;
	const onCreate = isNew ? props.onCreate : undefined;

	// Always call hook unconditionally (hook now handles undefined)
	useModel(epic);

	// Initialize description AST from plain text (recomputed when epic description changes)
	const initialDescriptionAst = useMemo(
		() => deserializeFromText(epic?.description || ''),
		[epic?.description]
	);

	// State for create mode
	const [titleDraft, setTitleDraft] = useState(epic?.title || '');
	const [isEditingDescription, setIsEditingDescription] = useState(isNew);
	const [descriptionAst, setDescriptionAst] = useState<Descendant[]>(initialDescriptionAst);
	const [statusDraft, setStatusDraft] = useState<Status>(epic?.status || 'ready');
	const [newTaskTitle, setNewTaskTitle] = useState('');

	const taskStats = epic?.taskStats || { total: 0, done: 0 };

	// Sync description AST state when epic changes (for navigation between epics)
	useEffect(() => {
		setDescriptionAst(initialDescriptionAst);
	}, [initialDescriptionAst]);

	// Task status toggle
	const handleToggleTaskStatus = (task: TaskModel): void => {
		task.status = task.status === 'done' ? 'ready' : 'done';
		// Note: Task saving would need API integration
	};

	// Description editing
	const handleEditDescription = (): void => {
		setDescriptionAst(deserializeFromText(epic?.description || ''));
		setIsEditingDescription(true);
	};

	const handleDescriptionChange = (value: Descendant[]): void => {
		setDescriptionAst(value);
	};

	const handleSaveDescription = (): void => {
		if (epic) {
			epic.description = serializeToText(descriptionAst);
			epic.save();
		}
		setIsEditingDescription(false);
	};

	const handleCancelDescription = (): void => {
		setIsEditingDescription(false);
		if (isNew) {
			setDescriptionAst(deserializeFromText(''));
		}
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

	// Status change (for create mode, just update the draft)
	const handleStatusChange = (e: Event): void => {
		const target = e.target as HTMLSelectElement;
		const newStatus = target.value as Status;
		if (isNew) {
			setStatusDraft(newStatus);
		} else if (epic) {
			epic.status = newStatus;
			epic.save();
		}
	};

	// Create epic
	const handleCreate = (): void => {
		if (!titleDraft.trim()) return;
		const descriptionText = serializeToText(descriptionAst);
		onCreate?.({
			title: titleDraft.trim(),
			description: descriptionText || undefined,
			status: statusDraft,
		});
	};

	// Delete epic
	const handleDelete = (): void => {
		if (epic && confirm('Are you sure you want to delete this epic?')) {
			onDelete?.(epic);
		}
	};

	return (
		<div class={styles.container}>
			{/* Title input for new epic */}
			{isNew && (
				<div class={styles.titleEdit}>
					<Text
						value={titleDraft}
						onInput={(e) => setTitleDraft((e.target as HTMLInputElement).value)}
						placeholder="Epic title..."
						label="Title"
					/>
				</div>
			)}

			{/* Description */}
			<section class={styles.section}>
				<div class={styles.sectionHeader}>
					<h3 class={styles.sectionTitle}>Description</h3>
					{!isNew && !isEditingDescription && (
						<Button class="text" onClick={handleEditDescription}>
							Edit
						</Button>
					)}
				</div>
				{isEditingDescription || isNew ? (
					<div class={styles.descriptionEdit}>
						<RichTextEditor
							key={epic?.id || 'new'}
							value={descriptionAst}
							onChange={handleDescriptionChange}
							placeholder="Add a description..."
						/>
						{!isNew && (
							<div class={styles.descriptionActions}>
								<Button onClick={handleSaveDescription}>
									Save
								</Button>
								<Button class="text" onClick={handleCancelDescription}>
									Cancel
								</Button>
							</div>
						)}
					</div>
				) : (
					<p class={styles.description}>
						{epic?.description || <span class={styles.placeholder}>No description</span>}
					</p>
				)}
			</section>

			{/* Tasks - only show for existing epics */}
			{!isNew && epic && (
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
						<Text
							value={newTaskTitle}
							onInput={(e) => setNewTaskTitle((e.target as HTMLInputElement).value)}
							onKeyDown={handleAddTaskKeyDown}
							placeholder="Add a task..."
						/>
						<Button
							class="text"
							onClick={handleAddTask}
							disabled={!newTaskTitle.trim()}
						>
							+ Add
						</Button>
					</div>
				</section>
			)}

			{/* Linked Documents (stub for now) - only show for existing epics */}
			{!isNew && (
				<section class={styles.section}>
					<div class={styles.sectionHeader}>
						<h3 class={styles.sectionTitle}>Linked Documents</h3>
						<Button class="text" disabled>
							+ Link Doc
						</Button>
					</div>
					<p class={styles.placeholder}>No linked documents</p>
				</section>
			)}

			{/* Controls */}
			<section class={styles.controls}>
				<div class={styles.controlGroup}>
					<label class={styles.controlLabel}>Status</label>
					<Select
						value={isNew ? statusDraft : (epic?.status || 'ready')}
						options={STATUS_OPTIONS}
						onChange={handleStatusChange}
					/>
				</div>
				{!isNew && (
					<div class={styles.controlGroup}>
						<label class={styles.controlLabel}>Assignee</label>
						<span class={styles.assigneeValue}>{epic?.assignee || 'Unassigned'}</span>
					</div>
				)}
			</section>

			{/* Footer */}
			<div class={styles.footer}>
				{isNew ? (
					<Button onClick={handleCreate} disabled={!titleDraft.trim()}>
						Create Epic
					</Button>
				) : (
					<Button class="danger" onClick={handleDelete}>
						Delete Epic
					</Button>
				)}
			</div>
		</div>
	);
}
