import type { JSX } from 'preact';
import styles from './AgentsButton.module.css';

export interface AgentsButtonProps {
	/** Live agent sessions right now. */
	count: number;
	/** The roster it opens is showing. */
	open: boolean;
	onClick(): void;
	/** The host's own button styling (the Map's toolbar, or the summary strip), so the button sits in either. */
	class?: string;
	disabled?: boolean;
}

/**
 * "Agents at work": a still amber dot, the label, and how many sessions are live. It
 * opens the roster and knows nothing else, so the summary strip can mount it where it
 * lives.
 */
export function AgentsButton({ count, open, onClick, class: className, disabled }: AgentsButtonProps): JSX.Element {
	return (
		<button type="button" class={className ? `${styles.button} ${className}` : styles.button} aria-expanded={open} aria-haspopup="dialog" disabled={disabled} onClick={onClick}>
			<span class={styles.dot} aria-hidden="true" />
			Agents at work
			<span class={styles.count}>{count}</span>
		</button>
	);
}
