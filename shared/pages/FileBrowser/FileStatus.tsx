import type { JSX } from 'preact';
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
	return (
		<span
			class={`${styles.dot} ${conflict ? styles.conflict : styles[status]} ${className || ''}`}
			title={conflict ? `${status} - someone else changed this file since your draft began` : `${status} - uncommitted`}
			aria-label={conflict ? `File ${status}, conflicts with a newer commit` : `File ${status}`}
		/>
	);
}
