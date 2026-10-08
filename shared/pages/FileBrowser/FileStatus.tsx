import type { JSX } from 'preact';
import { Icon } from '@specboard/ui';
import styles from './FileStatus.module.css';

/**
 * Git file change status types.
 */
export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface FileStatusProps {
	/** The type of change */
	status: FileChangeStatus;
	/** Someone committed a change to this file since this draft began */
	conflict?: boolean;
	/** Additional CSS classes */
	class?: string;
}

/**
 * FileStatus - visual indicator for git file change status.
 *
 * A small colored dot that indicates the type of uncommitted change
 * on a file in the file tree. Uses global color tokens:
 *
 * - added: success (green)
 * - modified: warning (yellow/orange)
 * - deleted: error (red)
 * - renamed: info (blue)
 */
export function FileStatus({
	status,
	conflict = false,
	class: className,
}: FileStatusProps): JSX.Element {
	if (conflict) {
		return (
			<ConflictMark
				label={`File ${status}, and someone else changed it since your draft began`}
				class={className}
			/>
		);
	}
	return (
		<span
			class={`${styles.dot} ${styles[status]} ${className || ''}`}
			title={`${status} - uncommitted`}
			role="img"
			aria-label={`File ${status}`}
		/>
	);
}

export interface ConflictMarkProps {
	/** What the mark means here, read out and shown as the tooltip */
	label: string;
	class?: string;
}

/**
 * Marks a draft that conflicts with a newer commit, or a collapsed folder holding one:
 * an alert glyph rather than a dot, so it doesn't rely on color.
 */
export function ConflictMark({ label, class: className }: ConflictMarkProps): JSX.Element {
	return (
		<span class={`${styles.conflict} ${className || ''}`} role="img" aria-label={label} title={label}>
			<Icon name="alert-circle" class="size-xs" aria-hidden />
		</span>
	);
}
