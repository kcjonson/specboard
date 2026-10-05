import type { JSX } from 'preact';
import styles from './AgentsButton.module.css';

export interface AgentsButtonProps {
	/** The roster it opens is showing. */
	open: boolean;
	onClick(): void;
	/** The host's own button styling, in place of the default, so the button sits wherever it is mounted. */
	class?: string;
	disabled?: boolean;
}

/**
 * "Agents at work": a still amber dot and the label. It opens the roster and knows nothing
 * else (the live count is the summary strip's), so it mounts wherever the host has room.
 */
export function AgentsButton({ open, onClick, class: className, disabled }: AgentsButtonProps): JSX.Element {
	return (
		<button type="button" class={className ?? styles.button} aria-expanded={open} aria-haspopup="dialog" disabled={disabled} onClick={onClick}>
			<span class={styles.dot} aria-hidden="true" />
			Agents at work
		</button>
	);
}
