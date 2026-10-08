import type { JSX } from 'preact';
import { useModel, type ItemModel } from '@specboard/models';
import { Avatar, Icon, StatusGlyph, STATUS_LABELS } from '@specboard/ui';
import { TypeBadge } from '../TypeBadge/TypeBadge';
import { ProjectChip, type ProjectLabel } from '../ProjectChip/ProjectChip';
import { ChildRow } from './ChildRow';
import styles from './Table.module.css';

export interface ItemRowProps {
	item: ItemModel;
	/** Whether rows may reveal their children at all (off while a filter is active). */
	expandable: boolean;
	expanded: boolean;
	selected: boolean;
	/** Briefly pulse the row (newly created, or changed by a background refresh). */
	flashing: boolean;
	onToggle: (item: ItemModel) => void;
	onOpen: (item: ItemModel) => void;
	onSelect?: (item: ItemModel | undefined) => void;
	/** Open a child's detail by key and the project it lives in, which is this item's. */
	onOpenChild?: (itemKey: string, projectRef: string) => void;
	/** The item's project, in a table that mixes projects; its children share it. */
	project?: ProjectLabel;
}

/**
 * A single item row in the table. Expands to reveal its children, which are lazily
 * fetched on first expand — `useModel` re-renders this row when they land.
 *
 * A search matches items at any depth, so this also renders child items, in the
 * section for their own status. Those carry `parentKey`, shown as a breadcrumb
 * before the title. No row expands while a filter is active (see Table): the
 * children endpoint is unfiltered, so it would duplicate the rows already matched.
 */
export function ItemRow({
	item,
	expandable,
	expanded,
	selected,
	flashing,
	onToggle,
	onOpen,
	onSelect,
	onOpenChild,
	project,
}: ItemRowProps): JSX.Element {
	// Subscribe so the row re-renders when fetch() populates children / flips $meta.
	useModel(item);

	const { total, done } = item.childStats;
	const hasChildren = total > 0;
	const canExpand = hasChildren && expandable;
	const showChildren = canExpand && expanded;
	const loadingChildren = item.$meta.working && item.children.length === 0;

	const handleToggle = (e: MouseEvent): void => {
		e.stopPropagation();
		onToggle(item);
	};

	const handleOpen = (): void => {
		onSelect?.(item);
		onOpen(item);
	};

	const handleOpenChild = (childKey: string): void => onOpenChild?.(childKey, item.projectRef);

	return (
		<>
			<div
				class={`${styles.row} ${styles.epicRow} ${selected ? styles.selected : ''} ${flashing ? styles.highlighted : ''}`}
				role="row"
				tabIndex={0}
				onClick={handleOpen}
				onKeyDown={(e) => {
					// The row's own Enter, not one bubbling from its expand button, which Enter presses.
					if (e.key === 'Enter' && e.target === e.currentTarget) handleOpen();
				}}
			>
				<span class={styles.colType} role="cell">
					<TypeBadge type={item.type} />
				</span>
				<span class={styles.colTitle} role="cell">
					{canExpand ? (
						<button
							type="button"
							class={styles.chevron}
							onClick={handleToggle}
							aria-label={expanded ? 'Collapse' : 'Expand'}
							aria-expanded={expanded}
						>
							<Icon name={expanded ? 'chevron-down' : 'chevron-right'} class="size-sm" />
						</button>
					) : (
						<span class={styles.chevronSpacer} />
					)}
					{item.parentKey && (
						<span class={styles.parentKey} title={`Child of ${item.parentKey}`}>{item.parentKey} /</span>
					)}
					<span class={styles.itemKey}>{item.key}</span>
					<span class={styles.title}>{item.title}</span>
					{item.blocked && item.status !== 'blocked' && (
						<span class={styles.blockedChip} title="This item has open blockers">Blocked</span>
					)}
				</span>
				{project && (
					<span class={styles.colProject} role="cell">
						<ProjectChip project={project} />
					</span>
				)}
				<span class={styles.colStatus} role="cell">
					<StatusGlyph status={item.status} blocked={item.blocked} decorative />
					{STATUS_LABELS[item.status]}
				</span>
				<span class={styles.colTasks} role="cell">{hasChildren ? `${done}/${total}` : '—'}</span>
				<span class={styles.colAssignee} role="cell">
					{item.assignee ? (
						<span class={styles.assignee}>
							<Avatar name={item.assignee.name} avatarUrl={item.assignee.avatarUrl} size="xs" tone="muted" decorative />
							<span class={styles.assigneeName}>{item.assignee.name}</span>
						</span>
					) : '—'}
				</span>
			</div>

			{showChildren && loadingChildren && (
				<div class={`${styles.row} ${styles.taskRow}`} role="row">
					<span class={styles.colType} role="cell" />
					<span class={`${styles.colTitle} ${styles.loadingTasks}`} role="cell">Loading…</span>
				</div>
			)}

			{showChildren &&
				!loadingChildren &&
				item.children.map((child) => <ChildRow key={child.id} child={child} project={project} onOpen={handleOpenChild} />)}
		</>
	);
}
