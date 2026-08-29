import { useState, useMemo, useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Descendant } from 'slate';
import { useModel, ItemModel, type ChildModel, type Status, type ItemStatus, type SubStatus, type ItemType, type ItemOrigin, type ItemWorker } from '@specboard/models';
import { Button, Select, Text } from '@specboard/ui';
import { TaskCard } from '../TaskCard/TaskCard';
import { TypeBadge } from '../TypeBadge/TypeBadge';
import { SpecsSection } from '../SpecsSection/SpecsSection';
import { BlockersSection } from '../BlockersSection/BlockersSection';
import { RichTextEditor, serializeToText, deserializeFromText } from '../RichTextEditor';
import styles from './ItemView.module.css';

const TYPE_LABELS: Record<ItemType, string> = {
	epic: 'Epic',
	task: 'Task',
	bug: 'Bug',
};

/** Props for viewing/editing an existing item */
interface ItemViewExistingProps {
	item: ItemModel;
	isNew?: false;
	createType?: never;
	onDelete?: (item: ItemModel) => void;
	onCreate?: never;
	/** Open a child's detail by key (clicking a child card). */
	onOpenChild?: (itemKey: string) => void;
}

/** Props for creating a new item */
interface ItemViewCreateProps {
	item?: never;
	isNew: true;
	createType?: ItemType;
	onDelete?: never;
	onCreate: (data: { title: string; description?: string; status: Status; type?: ItemType }) => void;
	onOpenChild?: never;
}

export type ItemViewProps = ItemViewExistingProps | ItemViewCreateProps;

const STATUS_OPTIONS: { value: ItemStatus; label: string }[] = [
	{ value: 'ready', label: 'Ready' },
	{ value: 'in_progress', label: 'In Progress' },
	{ value: 'blocked', label: 'Blocked' },
	{ value: 'done', label: 'Done' },
];

// Creating an item already blocked makes no sense; blockers get added after.
const CREATE_STATUS_OPTIONS = STATUS_OPTIONS.filter((o) => o.value !== 'blocked');

/** Milliseconds after which an agent session with no observed writes reads as stale. */
const WORKER_STALE_MS = 15 * 60 * 1000;

function workerLabel(worker: ItemWorker): string {
	return worker.actor.client?.name || worker.actor.deviceName || 'Agent session';
}

function originLabel(origin: ItemOrigin): string {
	if (origin.actor.type === 'agent') {
		const name = origin.actor.client?.name || 'Agent';
		return origin.actor.deviceName ? `${name} on ${origin.actor.deviceName}` : name;
	}
	if (origin.actor.type === 'system') return 'System';
	return 'User';
}

function formatTimeAgo(dateString: string): string {
	const diffMs = Date.now() - new Date(dateString).getTime();
	const diffMinutes = Math.floor(diffMs / (1000 * 60));
	const diffHours = Math.floor(diffMinutes / 60);
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays > 0) return `${diffDays}d ago`;
	if (diffHours > 0) return `${diffHours}h ago`;
	if (diffMinutes > 0) return `${diffMinutes}m ago`;
	return 'just now';
}

const SUB_STATUS_OPTIONS: { value: SubStatus; label: string }[] = [
	{ value: 'not_started', label: 'Not Started' },
	{ value: 'scoping', label: 'Scoping' },
	{ value: 'in_development', label: 'In Development' },
	{ value: 'paused', label: 'Paused' },
	{ value: 'needs_input', label: 'Needs Input' },
	{ value: 'pr_open', label: 'PR Open' },
	{ value: 'complete', label: 'Complete' },
];

export function ItemView(props: ItemViewProps): JSX.Element {
	const { isNew = false } = props;
	const item = isNew ? undefined : props.item;
	const onDelete = isNew ? undefined : props.onDelete;
	const onOpenChild = isNew ? undefined : props.onOpenChild;
	const onCreate = isNew ? props.onCreate : undefined;
	const itemType: ItemType = isNew ? (props.createType || 'epic') : (item?.type || 'epic');
	const typeLabel = TYPE_LABELS[itemType];

	// Always call hook unconditionally (hook now handles undefined)
	useModel(item);

	// Load the full detail (children) for an existing item that only has the list
	// summary so far. The table fetches on expand; opening the drawer needs them too.
	useEffect(() => {
		if (item && item.$meta.lastFetched == null && !item.$meta.working) {
			void item.fetch();
		}
	}, [item]);

	// Initialize description AST from plain text (recomputed when item description changes)
	const initialDescriptionAst = useMemo(
		() => deserializeFromText(item?.description || ''),
		[item?.description]
	);

	// State
	const [titleDraft, setTitleDraft] = useState(item?.title || '');
	const [descriptionAst, setDescriptionAst] = useState<Descendant[]>(initialDescriptionAst);
	const [statusDraft, setStatusDraft] = useState<Status>((item?.status as Status) || 'ready');
	const [newTaskTitle, setNewTaskTitle] = useState('');

	// Track whether description has unsaved changes
	const descriptionDirtyRef = useRef(false);

	const taskStats = item?.childStats || { total: 0, done: 0, blocked: 0 };

	// Sync the title draft to whichever item is open. Keyed on the model as well as
	// the title so switching to an item whose title hasn't arrived yet clears the
	// field instead of leaving the previous item's title sitting in it.
	useEffect(() => {
		setTitleDraft(item?.title || '');
	}, [item, item?.title]);

	// Sync description AST state when item changes (for navigation between items)
	useEffect(() => {
		setDescriptionAst(initialDescriptionAst);
		descriptionDirtyRef.current = false;
	}, [initialDescriptionAst]);

	// Task status toggle
	const handleToggleTaskStatus = (task: ChildModel): void => {
		if (!item) return;
		const prev = task.status;
		const next = prev === 'done' ? 'ready' : 'done';
		task.status = next; // optimistic; childStats reflects it immediately
		const target = new ItemModel({ key: task.key, projectSlug: item.projectSlug, status: next });
		target.save().catch(() => {
			task.status = prev;
		});
	};

	// Title — save on blur
	const handleTitleBlur = (): void => {
		if (!item || isNew) return;
		const trimmed = titleDraft.trim();
		if (trimmed && trimmed !== item.title) {
			const previousTitle = item.title;
			item.title = trimmed;
			item.save().catch(() => {
				item.title = previousTitle;
				setTitleDraft(previousTitle);
			});
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
		const previousDescription = item.description;
		item.description = serializeToText(descriptionAst);
		item.save().then(() => {
			descriptionDirtyRef.current = false;
		}).catch(() => {
			item.description = previousDescription;
		});
	};

	// Add task
	const handleAddTask = (): void => {
		if (!item || !newTaskTitle.trim()) return;
		const title = newTaskTitle.trim();
		setNewTaskTitle('');
		// Create a child task under this item, then reload so it appears in the list.
		const child = new ItemModel({ projectSlug: item.projectSlug, parentKey: item.key, title, type: 'task' });
		child.save().then(() => item.fetch()).catch(() => {});
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
		const newStatus = target.value as ItemStatus;
		if (isNew) {
			setStatusDraft(newStatus as Status);
		} else if (item) {
			const previousStatus = item.status;
			item.status = newStatus;
			item.save().catch(() => {
				item.status = previousStatus;
			});
		}
	};

	// Sub-status change
	const handleSubStatusChange = (e: Event): void => {
		if (!item || isNew) return;
		const target = e.target as HTMLSelectElement;
		const newSubStatus = target.value as SubStatus;
		const previousSubStatus = item.subStatus;
		item.subStatus = newSubStatus;
		item.save().catch(() => {
			item.subStatus = previousSubStatus;
		});
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
							aria-label={`${typeLabel} title`}
						/>
					</div>
				)}
				<div class={styles.fields}>
					<div class={styles.field}>
						<Select
							id="item-status"
							value={isNew ? statusDraft : (item?.status || 'ready')}
							options={isNew ? CREATE_STATUS_OPTIONS : STATUS_OPTIONS}
							onChange={handleStatusChange}
							label="Status"
						/>
					</div>
					{!isNew && (
						<div class={styles.field}>
							<Select
								id="item-sub-status"
								value={item?.subStatus || 'not_started'}
								options={SUB_STATUS_OPTIONS}
								onChange={handleSubStatusChange}
								label="Sub-Status"
							/>
						</div>
					)}
					{!isNew && (
						<div class={styles.field}>
							<label class={styles.fieldLabel}>Assignee</label>
							<span class={styles.fieldValue}>{item?.assignee || 'Unassigned'}</span>
						</div>
					)}
					{!isNew && item?.prUrl && (
						<div class={styles.field}>
							<label class={styles.fieldLabel}>Pull Request</label>
							<a
								class={styles.prLink}
								href={item.prUrl}
								target="_blank"
								rel="noopener noreferrer"
							>
								{item.prUrl.replace(/^https?:\/\/github\.com\//, '')}
							</a>
						</div>
					)}
					{!isNew && item?.origin && (
						<div class={styles.field}>
							<label class={styles.fieldLabel}>Created by</label>
							<span class={styles.fieldValue}>
								{originLabel(item.origin)}
								{item.origin.discoveredFrom && (
									<>
										{' · discovered from '}
										<button
											type="button"
											class={styles.inlineLink}
											onClick={() => item.origin?.discoveredFrom && onOpenChild?.(item.origin.discoveredFrom.itemKey)}
										>
											{item.origin.discoveredFrom.itemKey}
										</button>
									</>
								)}
							</span>
						</div>
					)}
					{!isNew && item?.workers && item.workers.length > 0 && (
						<div class={styles.field}>
							<label class={styles.fieldLabel}>Working now</label>
							<span class={styles.fieldValue}>
								{item.workers.map((worker, i) => {
									const stale = Date.now() - new Date(worker.lastSeenAt).getTime() > WORKER_STALE_MS;
									return (
										<span key={worker.id} class={stale ? styles.staleWorker : undefined}>
											{i > 0 && ', '}
											{workerLabel(worker)} · {formatTimeAgo(worker.lastSeenAt)}
											{stale && ' (stale)'}
										</span>
									);
								})}
							</span>
						</div>
					)}
				</div>
			</div>

			{/* Description — always editable */}
			<section class={styles.section}>
				<h3 class={styles.sectionTitle}>Description</h3>
				<div onBlur={handleDescriptionBlur}>
					<RichTextEditor
						value={descriptionAst}
						onChange={handleDescriptionChange}
						placeholder="Add a description..."
					/>
				</div>
			</section>

			{/* Tasks — only show for existing items */}
			{!isNew && item && item.type === 'epic' && (
				<section class={styles.section}>
					<h3 class={styles.sectionTitle}>
						Tasks ({taskStats.done}/{taskStats.total})
					</h3>
					<div class={styles.taskList} role="list">
						{item.children.map((task) => (
							<TaskCard key={task.id} task={task} onToggleStatus={handleToggleTaskStatus} onOpen={(child) => onOpenChild?.(child.key)} />
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

			{/* Blockers — for any existing work item */}
			{!isNew && item && (
				<BlockersSection
					projectSlug={item.projectSlug}
					itemKey={item.key}
					onOpenItem={onOpenChild}
					onChange={() => void item.fetch()}
				/>
			)}

			{/* Specifications — for any existing work item */}
			{!isNew && item && (
				<SpecsSection projectSlug={item.projectSlug} itemKey={item.key} />
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
