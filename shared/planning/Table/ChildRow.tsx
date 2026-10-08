import type { JSX } from 'preact';
import type { ChildModel } from '@specboard/models';
import { StatusGlyph, STATUS_LABELS } from '@specboard/ui';
import { TypeBadge } from '../TypeBadge/TypeBadge';
import { ProjectChip, type ProjectLabel } from '../ProjectChip/ProjectChip';
import styles from './Table.module.css';

export interface ChildRowProps {
	child: ChildModel;
	/** The parent's project, in a table that mixes projects. */
	project?: ProjectLabel;
	/** Open this child's detail by key (children are first-class items). */
	onOpen?: (itemKey: string) => void;
}

/** A child item row, indented one level under its parent. Clickable to open its detail. */
export function ChildRow({ child, project, onOpen }: ChildRowProps): JSX.Element {
	const handleOpen = (): void => onOpen?.(child.key);
	return (
		<div
			class={`${styles.row} ${styles.taskRow} ${styles.clickable}`}
			role="row"
			tabIndex={0}
			onClick={handleOpen}
			onKeyDown={(e) => {
				if (e.key === 'Enter') handleOpen();
			}}
		>
			<span class={styles.colType} role="cell">
				<TypeBadge type={child.type} />
			</span>
			<span class={styles.colTitle} role="cell">
				<span class={styles.chevronSpacer} />
				<span class={styles.itemKey}>{child.key}</span>
				<span class={styles.taskTitle}>{child.title}</span>
				{child.blocked && child.status !== 'blocked' && (
					<span class={styles.blockedChip} title="This item has open blockers">Blocked</span>
				)}
			</span>
			{project && (
				<span class={styles.colProject} role="cell">
					<ProjectChip project={project} />
				</span>
			)}
			<span class={styles.colStatus} role="cell">
				<StatusGlyph status={child.status} blocked={child.blocked} decorative />
				{STATUS_LABELS[child.status]}
			</span>
			<span class={styles.colTasks} role="cell" />
			<span class={styles.colAssignee} role="cell" />
		</div>
	);
}
