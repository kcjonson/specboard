import { useState, useMemo, useEffect, useCallback, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Descendant } from 'slate';
import { navigate } from '@specboard/router';
import { useModel, ItemModel, type TaskModel, type Status, type ItemType } from '@specboard/models';
import { fetchClient } from '@specboard/fetch';
import { Button, Select, Text } from '@specboard/ui';
import { TaskCard } from '../TaskCard/TaskCard';
import { TypeBadge } from '../TypeBadge/TypeBadge';
import { RichTextEditor, serializeToText, deserializeFromText } from '../RichTextEditor';
import styles from './ItemView.module.css';

const TYPE_LABELS: Record<ItemType, string> = {
	epic: 'Epic',
	chore: 'Chore',
	bug: 'Bug',
};

/** Props for viewing/editing an existing item */
interface ItemViewExistingProps {
	item: ItemModel;
	isNew?: false;
	createType?: never;
	onDelete?: (item: ItemModel) => void;
	onCreate?: never;
}

/** Props for creating a new item */
interface ItemViewCreateProps {
	item?: never;
	isNew: true;
	createType?: ItemType;
	onDelete?: never;
	onCreate: (data: { title: string; description?: string; status: Status; type?: ItemType }) => void;
}

export type ItemViewProps = ItemViewExistingProps | ItemViewCreateProps;

const STATUS_OPTIONS: { value: Status; label: string }[] = [
	{ value: 'ready', label: 'Ready' },
	{ value: 'in_progress', label: 'In Progress' },
	{ value: 'done', label: 'Done' },
];

export function ItemView(props: ItemViewProps): JSX.Element {
	const { isNew = false } = props;
	const item = isNew ? undefined : props.item;
	const onDelete = isNew ? undefined : props.onDelete;
	const onCreate = isNew ? props.onCreate : undefined;
	const itemType: ItemType = isNew ? (props.createType || 'epic') : (item?.type || 'epic');
	const typeLabel = TYPE_LABELS[itemType];

	// Always call hook unconditionally (hook now handles undefined)
	useModel(item);

	// Initialize description AST from plain text (recomputed when item description changes)
	const initialDescriptionAst = useMemo(
		() => deserializeFromText(item?.description || ''),
		[item?.description]
	);

	// State
	const [titleDraft, setTitleDraft] = useState(item?.title || '');
	const [descriptionAst, setDescriptionAst] = useState<Descendant[]>(initialDescriptionAst);
	const [statusDraft, setStatusDraft] = useState<Status>(item?.status || 'ready');
	const [newTaskTitle, setNewTaskTitle] = useState('');

	// Track whether description has unsaved changes
	const descriptionDirtyRef = useRef(false);

	// Spec document existence check: null = checking, true = exists, false = missing
	const [specDocExists, setSpecDocExists] = useState<boolean | null>(null);

	const taskStats = item?.taskStats || { total: 0, done: 0 };

	// Sync title draft when item data loads
	useEffect(() => {
		if (item?.title) {
			setTitleDraft(item.title);
		}
	}, [item?.title]);

	// Sync description AST state when item changes (for navigation between items)
	useEffect(() => {
		setDescriptionAst(initialDescriptionAst);
		descriptionDirtyRef.current = false;
	}, [initialDescriptionAst]);

	// Check if spec document exists when item changes
	useEffect(() => {
		const specDocPath = item?.specDocPath;
		const projectId = item?.projectId;
		if (!specDocPath || !projectId) {
			setSpecDocExists(null);
			return;
		}

		let cancelled = false;
		setSpecDocExists(null); // Reset to checking state

		const checkExists = async (): Promise<void> => {
			try {
				await fetchClient.get(
					`/api/projects/${projectId}/files?path=${encodeURIComponent(specDocPath)}`
				);
				if (!cancelled) {
					setSpecDocExists(true);
				}
			} catch {
				if (!cancelled) {
					setSpecDocExists(false);
				}
			}
		};

		checkExists();
		return () => {
			cancelled = true;
		};
	}, [item?.specDocPath, item?.projectId]);

	// Unlink spec document from item
	const handleUnlinkSpec = useCallback(async (): Promise<void> => {
		if (!item) return;

		const previousSpecDocPath = item.specDocPath;
		item.specDocPath = undefined;

		try {
			await item.save();
			setSpecDocExists(null);
		} catch (err) {
			// Revert on failure
			item.specDocPath = previousSpecDocPath;
			console.error('Failed to unlink spec document:', err);
		}
	}, [item]);

	// Task status toggle
	const handleToggleTaskStatus = (task: TaskModel): void => {
		task.status = task.status === 'done' ? 'ready' : 'done';
	};

	// Title — save on blur
	const handleTitleBlur = (): void => {
		if (!item || isNew) return;
		const trimmed = titleDraft.trim();
		if (trimmed && trimmed !== item.title) {
			item.title = trimmed;
			item.save();
		}
	};

	const handleTitleKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Enter') {
			(e.target as HTMLInputElement).blur();
		}
	};

	// Description — save on blur
	const handleDescriptionChange = (value: Descendant[]): void => {
		setDescriptionAst(value);
		descriptionDirtyRef.current = true;
	};

	const handleDescriptionBlur = (): void => {
		if (!item || isNew || !descriptionDirtyRef.current) return;
		item.description = serializeToText(descriptionAst);
		item.save();
		descriptionDirtyRef.current = false;
	};

	// Add task
	const handleAddTask = (): void => {
		if (!newTaskTitle.trim()) return;
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
		} else if (item) {
			item.status = newStatus;
			item.save();
		}
	};

	// Create item
	const handleCreate = (): void => {
		if (!titleDraft.trim()) return;
		const descriptionText = serializeToText(descriptionAst);
		onCreate?.({
			title: titleDraft.trim(),
			description: descriptionText || undefined,
			status: statusDraft,
			type: itemType,
		});
	};

	// Delete item
	const handleDelete = (): void => {
		if (item && confirm(`Are you sure you want to delete this ${typeLabel.toLowerCase()}?`)) {
			onDelete?.(item);
		}
	};

	return (
		<div class={styles.container}>
			{/* Header: Title, Type, and Metadata */}
			<div class={styles.header}>
				{isNew ? (
					<div class={styles.titleEdit}>
						<Text
							value={titleDraft}
							onInput={(e) => setTitleDraft((e.target as HTMLInputElement).value)}
							placeholder={`${typeLabel} title...`}
							label="Title"
						/>
					</div>
				) : (
					<div class={styles.titleRow}>
						<TypeBadge type={itemType} />
						<input
							class={styles.titleInput}
							value={titleDraft}
							onInput={(e) => setTitleDraft((e.target as HTMLInputElement).value)}
							onBlur={handleTitleBlur}
							onKeyDown={handleTitleKeyDown}
							placeholder={`${typeLabel} title...`}
						/>
					</div>
				)}
				<div class={styles.fields}>
					<div class={styles.field}>
						<label class={styles.fieldLabel}>Status</label>
						<Select
							value={isNew ? statusDraft : (item?.status || 'ready')}
							options={STATUS_OPTIONS}
							onChange={handleStatusChange}
						/>
					</div>
					{!isNew && (
						<div class={styles.field}>
							<label class={styles.fieldLabel}>Assignee</label>
							<span class={styles.fieldValue}>{item?.assignee || 'Unassigned'}</span>
						</div>
					)}
				</div>
			</div>

			{/* Description — always editable */}
			<section class={styles.section}>
				<h3 class={styles.sectionTitle}>Description</h3>
				<div onBlur={handleDescriptionBlur}>
					<RichTextEditor
						key={item?.id || 'new'}
						value={descriptionAst}
						onChange={handleDescriptionChange}
						placeholder="Add a description..."
					/>
				</div>
			</section>

			{/* Tasks — only show for existing items */}
			{!isNew && item && (
				<section class={styles.section}>
					<h3 class={styles.sectionTitle}>
						Tasks ({taskStats.done}/{taskStats.total})
					</h3>
					<div class={styles.taskList} role="list">
						{item.tasks.map((task) => (
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

			{/* Specification Document — only show for epics */}
			{!isNew && item?.type === 'epic' && (
				<section class={styles.section}>
					<h3 class={styles.sectionTitle}>Specification</h3>
					{item?.specDocPath ? (
						<div class={styles.specContainer}>
							{specDocExists === false && (
								<div class={styles.specWarning}>
									Document not found - file may have been moved or deleted
								</div>
							)}
							<div class={styles.specActions}>
								<button
									type="button"
									class={specDocExists === false ? styles.specLinkMissing : styles.specLink}
									disabled={specDocExists === false}
									aria-label={specDocExists === false ? 'Specification document not found' : 'Open specification document'}
									onClick={() => navigate(`/projects/${item.projectId}/pages?file=${encodeURIComponent(item.specDocPath!)}`)}
								>
									{item.specDocPath}
								</button>
								<Button class="text" onClick={handleUnlinkSpec}>
									Unlink
								</Button>
							</div>
						</div>
					) : (
						<p class={styles.placeholder}>No specification linked</p>
					)}
				</section>
			)}

			{/* Footer */}
			<div class={styles.footer}>
				{isNew ? (
					<Button onClick={handleCreate} disabled={!titleDraft.trim()}>
						Create {typeLabel}
					</Button>
				) : (
					<Button class="danger" onClick={handleDelete}>
						Delete {typeLabel}
					</Button>
				)}
			</div>
		</div>
	);
}
