import type { JSX } from 'preact';
import { LAPTOP, LAPTOP_BOX } from './renderer';
import styles from './AgentsButton.module.css';

export interface AgentsButtonProps {
	/** The roster it opens is showing. */
	open: boolean;
	onClick(): void;
	/** The host's own button styling, in place of the default, so the button sits wherever it is mounted. */
	class?: string;
	disabled?: boolean;
	/** Draw the laptop the Map uses for a computer in place of the dot and the words; the name stays. */
	compact?: boolean;
}

/**
 * "Agents at work": a still amber dot and the label, or just the laptop when `compact`. It
 * opens the roster and knows nothing else (the live count is the summary strip's), so it
 * mounts wherever the host has room.
 */
export function AgentsButton({ open, onClick, class: className, disabled, compact = false }: AgentsButtonProps): JSX.Element {
	return (
		<button
			type="button"
			class={className ?? styles.button}
			aria-expanded={open}
			aria-haspopup="dialog"
			aria-label={compact ? 'Agents at work' : undefined}
			title={compact ? 'Agents at work' : undefined}
			disabled={disabled}
			onClick={onClick}
		>
			{compact ? (
				<svg class={styles.laptop} viewBox={`0 0 ${LAPTOP_BOX} ${LAPTOP_BOX}`} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d={LAPTOP} />
				</svg>
			) : (
				<>
					<span class={styles.dot} aria-hidden="true" />
					Agents at work
				</>
			)}
		</button>
	);
}
