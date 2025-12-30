import type { JSX } from 'preact';
import styles from './StatusDot.module.css';

export type StatusType = 'ready' | 'in_progress' | 'in_review' | 'done' | 'default';

export interface StatusDotProps {
	/** Status type determines color */
	status: StatusType;
	/** Additional CSS class (use size-sm, size-lg for modifiers) */
	class?: string;
}

export function StatusDot({
	status,
	class: className,
}: StatusDotProps): JSX.Element {
	return (
		<span
			class={`${styles.dot} ${styles[status]} ${className || ''}`}
			aria-hidden="true"
		/>
	);
}
