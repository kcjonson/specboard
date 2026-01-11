import type { JSX } from 'preact';
import styles from './FileStatus.module.css';

/**
 * Git file change status types.
 */
export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface FileStatusProps {
	/** The type of change */
	status: FileChangeStatus;
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
	class: className,
}: FileStatusProps): JSX.Element {
	return (
		<span
			class={`${styles.dot} ${styles[status]} ${className || ''}`}
			title={`${status} - uncommitted`}
			aria-label={`File ${status}`}
		/>
	);
}
