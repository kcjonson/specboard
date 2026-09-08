import { useState, useMemo, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { useModel, ItemModel, type ChildModel, type ItemType } from '@specboard/models';
import { SplitButton, StatusDot, STATUS_LABELS, DOT_STATUS, type SplitButtonOption } from '@specboard/ui';
import { TypeBadge } from '../TypeBadge/TypeBadge';
import { NewItemDialog } from '../NewItemDialog/NewItemDialog';
import type { NewItemData } from '../NewItemForm/NewItemForm';
import { TYPE_LABELS } from '../utils/itemType';
import styles from './ChildrenSection.module.css';

/**
 * Rows shown before "Show all". An epic with forty children is ~1100px of drawer
 * ahead of Blockers, Specs, and the activity log — the sections that answer why
 * the work is stuck. The table has the horizontal room to show them all; this
 * doesn't.
 */
const VISIBLE_LIMIT = 10;

export interface ChildrenSectionProps {
	item: ItemModel;
	/** Open a child's detail by key; children are first-class items. */
	onOpenItem?: (itemKey: string) => void;
}

/**
 * An item's child items: a summary that agrees with the table, not a todo list.
 * There is deliberately no checkbox — a child carries a status, a sub-status,
 * blockers, and an activity log, and a checkbox writing `status` alone would
 * quietly discard the rest. Loose to-dos belong in the checklist.
 */
export function ChildrenSection({ item, onOpenItem }: ChildrenSectionProps): JSX.Element {
	useModel(item);

	const [createType, setCreateType] = useState<ItemType | undefined>(undefined);
	const [showAll, setShowAll] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const stats = item.childStats;
	const children = item.children.toArray();
	const visible = showAll ? children : children.slice(0, VISIBLE_LIMIT);

	const createOptions: SplitButtonOption[] = useMemo(() => [
		{ label: 'Task', value: 'task', icon: 'checkbox-unchecked' as const, onClick: () => setCreateType('task') },
		{ label: 'Bug', value: 'bug', icon: 'bug' as const, onClick: () => setCreateType('bug') },
		{ label: 'Epic', value: 'epic', icon: 'file' as const, onClick: () => setCreateType('epic') },
	], []);

	const handleCreate = useCallback(async (data: NewItemData): Promise<void> => {
		setError(null);
		// The dialog opens on this item as the parent but the user can change it, so the
		// payload's parentKey wins. Repointing it elsewhere means the new item doesn't
		// land in this list, which is what was asked for.
		const child = new ItemModel({ ...data, projectSlug: item.projectSlug });
		try {
			await child.save();
		} catch {
			setError(`Could not create that ${TYPE_LABELS[data.type || 'task'].toLowerCase()}.`);
			return;
		} finally {
			// Closed either way. The dialog is a native modal in the top layer, so an
			// error left behind it would be invisible until the user gave up and closed
			// it; the draft is the price of putting the message where they're looking.
			setCreateType(undefined);
		}

		// The item exists from here on, so nothing below may report a failure to
		// create it. A refresh that fails leaves the list a poll behind, which is
		// recoverable; telling someone their item was not created when it was would
		// have them make it twice.
		if (data.parentKey !== item.key) return;
		try {
			// FetchClient coalesces concurrent GETs by URL, so a read issued now can
			// hand back one that started before the POST and miss the child we just
			// made. Drain any in-flight read first, then take a fresh one.
			if (item.$meta.working) await item.fetch();
			await item.fetch();
		} catch {
			setError('Created, but the list could not be refreshed.');
		}
	}, [item]);

	const renderRow = (child: ChildModel): JSX.Element => {
		// Without a way to open a child, a row is text. Keeping it focusable and
		// clickable would only add a tab stop that does nothing.
		const open = onOpenItem ? (): void => onOpenItem(child.key) : undefined;
		return (
			<div
				key={child.id}
				class={open ? `${styles.row} ${styles.clickable}` : styles.row}
				role="listitem"
				tabIndex={open ? 0 : undefined}
				onClick={open}
				onKeyDown={open && ((e: KeyboardEvent) => {
					if (e.key === 'Enter') open();
				})}
			>
				<TypeBadge type={child.type} />
				<span class={styles.key}>{child.key}</span>
				<span class={styles.title}>{child.title}</span>
				{child.blocked && child.status !== 'blocked' && (
					<span class={styles.blockedChip} title="This item has open blockers">Blocked</span>
				)}
				<span class={styles.status}>
					<StatusDot status={DOT_STATUS[child.status]} />
					{STATUS_LABELS[child.status]}
				</span>
			</div>
		);
	};

	// A childless task or bug still gets the header, so children can be added where
	// there are none; an empty-state paragraph on every such item would be noise.
	const bare = stats.total === 0 && item.type !== 'epic';

	return (
		<section class={styles.section}>
			<div class={styles.header}>
				<h3 class={styles.sectionTitle}>
					Children ({stats.done}/{stats.total})
				</h3>
				<SplitButton options={createOptions} prefix="+ Add" />
			</div>

			{error && <div class={styles.error}>{error}</div>}

			{!bare && (
				<>
					<div class={styles.list} role="list">
						{visible.map(renderRow)}
					</div>
					{/* Keyed on the count, not on the loaded rows: the drawer can open on a
					    list summary whose children are still in flight, and "No children yet"
					    under a header reading 7 would be a flat contradiction. */}
					{stats.total === 0 && <p class={styles.placeholder}>No children yet</p>}
					{!showAll && children.length > VISIBLE_LIMIT && (
						<button type="button" class={styles.showAll} onClick={() => setShowAll(true)}>
							Show all {children.length}
						</button>
					)}
				</>
			)}

			{createType && (
				<NewItemDialog
					projectSlug={item.projectSlug}
					createType={createType}
					parentKey={item.key}
					onClose={() => setCreateType(undefined)}
					onCreate={(data) => void handleCreate(data)}
				/>
			)}
		</section>
	);
}
