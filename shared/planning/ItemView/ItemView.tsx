import { useState, useMemo, useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Descendant } from 'slate';
import { useModel, type ItemModel, type ItemStatus, type SubStatus } from '@specboard/models';
import { FetchError } from '@specboard/fetch';
import { Button, DialogFooter, Select } from '@specboard/ui';
import { ItemPicker } from '@specboard/pages';
import { TypeBadge } from '../TypeBadge/TypeBadge';
import { ChildrenSection } from '../ChildrenSection/ChildrenSection';
import { ChecklistSection } from '../ChecklistSection/ChecklistSection';
import { SpecsSection } from '../SpecsSection/SpecsSection';
import { BlockersSection } from '../BlockersSection/BlockersSection';
import { NotesSection } from '../NotesSection/NotesSection';
import { actorLabel } from '../utils/actor';
import { TYPE_LABELS } from '../utils/itemType';
import { RichTextEditor, serializeToText, deserializeFromText } from '../RichTextEditor';
import { formatTimeAgo } from '../utils/time';
import styles from './ItemView.module.css';

/** Titles stay one line of text; the textarea is only there so it wraps visually. */
function stripNewlines(value: string): string {
	return value.replace(/[\r\n]+/g, ' ');
}

export interface ItemViewProps {
	item: ItemModel;
	onDelete?: (item: ItemModel) => void;
	/** Open another item's detail by key — a child, this item's parent, or where it was discovered. */
	onOpenItem?: (itemKey: string) => void;
}

const STATUS_OPTIONS: { value: ItemStatus; label: string }[] = [
	{ value: 'ready', label: 'Ready' },
	{ value: 'in_progress', label: 'In Progress' },
	{ value: 'blocked', label: 'Blocked' },
	{ value: 'in_review', label: 'In Review' },
	{ value: 'done', label: 'Done' },
];

/**
 * Mirror of the server's sub-status -> status derive. The server only applies
 * it when a write carries sub_status WITHOUT status, and SyncModel.save() PUTs
 * the whole model — so the client must move status itself or "Complete" would
 * leave the item in its old column.
 */
function deriveStatusFromSubStatus(subStatus: SubStatus): ItemStatus | undefined {
	switch (subStatus) {
		case 'scoping':
		case 'in_development':
		case 'pr_open':
			return 'in_progress';
		case 'complete':
			return 'done';
		default:
			return undefined;
	}
}

/** Milliseconds after which an agent session with no observed writes reads as stale. */
const WORKER_STALE_MS = 15 * 60 * 1000;

const SUB_STATUS_OPTIONS: { value: SubStatus; label: string }[] = [
	{ value: 'not_started', label: 'Not Started' },
	{ value: 'scoping', label: 'Scoping' },
	{ value: 'in_development', label: 'In Development' },
	{ value: 'paused', label: 'Paused' },
	{ value: 'needs_input', label: 'Needs Input' },
	{ value: 'pr_open', label: 'PR Open' },
	{ value: 'complete', label: 'Complete' },
];

export function ItemView({ item, onDelete, onOpenItem }: ItemViewProps): JSX.Element {
	// Fields can still be unpopulated on a list summary whose detail fetch is in flight.
	const itemType = item.type || 'epic';
	const typeLabel = TYPE_LABELS[itemType];

	useModel(item);

	// Load the full detail (children) for an item that only has the list summary
	// so far. The table fetches on expand; opening the drawer needs them too.
	useEffect(() => {
		if (item.$meta.lastFetched == null && !item.$meta.working) {
			void item.fetch();
		}
	}, [item]);

	// Keyed on the model as well as the text, for the reason the title draft is:
	// two items with the same description (empty is the common case) would other-
	// wise memoize to one identity, the reset effect below would never fire, and
	// the previous item's unsaved draft would carry over — and save onto the new
	// item on blur, because the dirty flag carries over with it.
	const initialDescriptionAst = useMemo(
		() => deserializeFromText(item.description || ''),
		[item, item.description]
	);

	// State
	const [titleDraft, setTitleDraft] = useState(stripNewlines(item.title || ''));
	const titleRef = useRef<HTMLTextAreaElement>(null);
	const [descriptionAst, setDescriptionAst] = useState<Descendant[]>(initialDescriptionAst);

	// Track whether description has unsaved changes
	const descriptionDirtyRef = useRef(false);

	const [parentPickerOpen, setParentPickerOpen] = useState(false);
	const [parentError, setParentError] = useState<string | null>(null);

	// Sync the title draft to whichever item is open. Keyed on the model as well as
	// the title so switching to an item whose title hasn't arrived yet clears the
	// field instead of leaving the previous item's title sitting in it.
	useEffect(() => {
		setTitleDraft(stripNewlines(item.title || ''));
	}, [item, item.title]);

	// A textarea won't grow on its own, so drive its height from the content.
	const fitTitle = (): void => {
		const el = titleRef.current;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${el.scrollHeight}px`;
	};

	useEffect(fitTitle, [titleDraft]);

	// Width changes rewrap the text, and the drawer and the full-screen view are
	// very different widths, so the fitted height has to be recomputed.
	useEffect(() => {
		const el = titleRef.current;
		if (!el || typeof ResizeObserver === 'undefined') return;
		let lastWidth = el.clientWidth;
		const observer = new ResizeObserver(() => {
			if (el.clientWidth === lastWidth) return;
			lastWidth = el.clientWidth;
			fitTitle();
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	// Sync description AST state when item changes (for navigation between items)
	useEffect(() => {
		setDescriptionAst(initialDescriptionAst);
		descriptionDirtyRef.current = false;
	}, [item, initialDescriptionAst]);

	// Title — save on blur
	const handleTitleBlur = (): void => {
		const trimmed = titleDraft.trim();
		// Compare against the normalized stored title: a title that arrived with
		// newlines would otherwise look edited the moment the field is focused, and
		// merely tabbing through it would write.
		if (trimmed && trimmed !== stripNewlines(item.title).trim()) {
			const previousTitle = item.title;
			item.title = trimmed;
			item.save().catch(() => {
				item.title = previousTitle;
				setTitleDraft(stripNewlines(previousTitle));
			});
		}
	};

	const handleTitleKeyDown = (e: KeyboardEvent): void => {
		// The title is a textarea only so it can wrap; Enter still commits.
		if (e.key === 'Enter') {
			e.preventDefault();
			(e.target as HTMLTextAreaElement).blur();
		}
	};

	// Description — save on blur
	const handleDescriptionChange = (value: Descendant[]): void => {
		setDescriptionAst(value);
		descriptionDirtyRef.current = true;
	};

	const handleDescriptionBlur = (): void => {
		if (!descriptionDirtyRef.current) return;
		const previousDescription = item.description;
		item.description = serializeToText(descriptionAst);
		item.save().then(() => {
			descriptionDirtyRef.current = false;
		}).catch(() => {
			item.description = previousDescription;
		});
	};

	const handleStatusChange = (e: Event): void => {
		const target = e.target as HTMLSelectElement;
		const previousStatus = item.status;
		item.status = target.value as ItemStatus;
		item.save().catch(() => {
			item.status = previousStatus;
		});
	};

	// Sub-status change (moves status too at the key transitions)
	const handleSubStatusChange = (e: Event): void => {
		const target = e.target as HTMLSelectElement;
		const newSubStatus = target.value as SubStatus;
		const previousSubStatus = item.subStatus;
		const previousStatus = item.status;
		item.subStatus = newSubStatus;
		const derived = deriveStatusFromSubStatus(newSubStatus);
		if (derived && derived !== item.status) item.status = derived;
		item.save().catch(() => {
			item.subStatus = previousSubStatus;
			item.status = previousStatus;
		});
	};

	const movingRef = useRef(false);

	// Reparenting goes through the move route, not save(): PUT drops parentKey.
	// The server owns the cycle check (it runs inside the UPDATE, so a rejected
	// move leaves the item attached to the parent it had), so nothing is
	// validated here — the message it sends back is the message shown.
	const handleMove = (parentKey: string | null): void => {
		// One move at a time. move() applies the response it gets back, so two in
		// flight can settle out of order and leave the field showing the parent from
		// the earlier request. Guarded on its own flag rather than $meta.working,
		// which a title or description save also raises — those should not block a
		// reparent.
		if (movingRef.current) return;
		movingRef.current = true;
		setParentPickerOpen(false);
		setParentError(null);
		item.move(parentKey)
			.catch((err: unknown) => {
				const data = err instanceof FetchError ? (err.data as { error?: string } | undefined) : undefined;
				setParentError(data?.error ?? 'Could not change the parent.');
			})
			.finally(() => {
				movingRef.current = false;
			});
	};

	// Delete item
	const handleDelete = (): void => {
		if (confirm(`Are you sure you want to delete this ${typeLabel.toLowerCase()}?`)) {
			onDelete?.(item);
		}
	};

	return (
		<div class={styles.container}>
			{/* Header: Title, Type, and Metadata */}
			<div class={styles.header}>
				<div class={styles.titleRow}>
					<span class={styles.titleBadge}>
						<TypeBadge type={itemType} />
					</span>
					<textarea
						ref={titleRef}
						rows={1}
						class={styles.titleInput}
						value={titleDraft}
						onInput={(e) => setTitleDraft(stripNewlines((e.target as HTMLTextAreaElement).value))}
						onBlur={handleTitleBlur}
						onKeyDown={handleTitleKeyDown}
						placeholder={`${typeLabel} title...`}
						aria-label={`${typeLabel} title`}
					/>
				</div>
				<div class={styles.fields}>
					<div class={styles.field}>
						<Select
							id="item-status"
							value={item.status || 'ready'}
							options={STATUS_OPTIONS}
							onChange={handleStatusChange}
							label="Status"
						/>
					</div>
					<div class={styles.field}>
						<Select
							id="item-sub-status"
							value={item.subStatus || 'not_started'}
							options={SUB_STATUS_OPTIONS}
							onChange={handleSubStatusChange}
							label="Sub-Status"
						/>
					</div>
					{/* A parented epic is legal, so an epic that has one still shows it; an
					    epic without one is the ordinary top-level case and gets no row. */}
					{(itemType !== 'epic' || item.parentKey) && (
						<div class={styles.field}>
							{/* Not a <label>: the parent is a link plus a button, not a form
							    control, and a label with nothing to point at announces nothing. */}
							<span class={styles.fieldLabel}>Parent</span>
							<span class={styles.fieldValue}>
								{item.parentKey ? (
									<button
										type="button"
										class={styles.inlineLink}
										onClick={() => item.parentKey && onOpenItem?.(item.parentKey)}
									>
										{item.parentKey}{item.parentTitle ? ` · ${item.parentTitle}` : ''}
									</button>
								) : 'None'}
							</span>
							<button
								type="button"
								class={styles.inlineLink}
								onClick={() => setParentPickerOpen(true)}
								aria-label="Change parent"
							>
								Change
							</button>
						</div>
					)}
					<div class={styles.field}>
						<span class={styles.fieldLabel}>Assignee</span>
						<span class={styles.fieldValue}>{item.assignee || 'Unassigned'}</span>
					</div>
					{item.prUrl && (
						<div class={styles.field}>
							<span class={styles.fieldLabel}>Pull Request</span>
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
					{item.origin && (
						<div class={styles.field}>
							<span class={styles.fieldLabel}>Created by</span>
							<span class={styles.fieldValue}>
								{actorLabel(item.origin.actor)}
								{item.origin.discoveredFrom && (
									<>
										{' · discovered from '}
										<button
											type="button"
											class={styles.inlineLink}
											onClick={() => item.origin?.discoveredFrom && onOpenItem?.(item.origin.discoveredFrom.itemKey)}
										>
											{item.origin.discoveredFrom.itemKey}
										</button>
									</>
								)}
							</span>
						</div>
					)}
					{item.workers && item.workers.length > 0 && (
						<div class={styles.field}>
							<span class={styles.fieldLabel}>Working now</span>
							<span class={styles.fieldValue}>
								{item.workers.map((worker, i) => {
									const stale = Date.now() - new Date(worker.lastSeenAt).getTime() > WORKER_STALE_MS;
									return (
										<span key={worker.id} class={stale ? styles.staleWorker : undefined}>
											{i > 0 && ', '}
											{actorLabel(worker.actor)} · {formatTimeAgo(worker.lastSeenAt)}
											{stale && ' (stale)'}
										</span>
									);
								})}
							</span>
						</div>
					)}
					{parentError && <div class={styles.fieldError} role="alert">{parentError}</div>}
				</div>
			</div>

			{parentPickerOpen && (
				<ItemPicker
					projectSlug={item.projectSlug}
					title="Choose a parent"
					// A UI choice, not a model rule: the schema puts no type restriction on
					// parenting (a task under a bug, an epic under an epic all validate, on
					// create and on move). Offering only epics keeps the ordinary shape
					// obvious — do not "fix" the model to match this.
					type="epic"
					clearOption={item.parentKey ? { label: 'No parent', onSelect: () => handleMove(null) } : undefined}
					onSelect={handleMove}
					onClose={() => setParentPickerOpen(false)}
				/>
			)}

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

			<ChildrenSection item={item} onOpenItem={onOpenItem} />

			<ChecklistSection projectSlug={item.projectSlug} itemKey={item.key} />

			<BlockersSection
				projectSlug={item.projectSlug}
				itemKey={item.key}
				onOpenItem={onOpenItem}
				onChange={() => void item.fetch()}
			/>

			<SpecsSection projectSlug={item.projectSlug} itemKey={item.key} />

			<NotesSection projectSlug={item.projectSlug} itemKey={item.key} />

			<DialogFooter divider>
				<Button class="danger" onClick={handleDelete}>
					Delete {typeLabel}
				</Button>
			</DialogFooter>
		</div>
	);
}
