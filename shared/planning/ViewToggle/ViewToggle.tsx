import type { JSX } from 'preact';
import styles from './ViewToggle.module.css';

/** The two ways to view planning work items. */
export type PlanningView = 'board' | 'table';

const VIEWS: { value: PlanningView; label: string }[] = [
	{ value: 'board', label: 'Board' },
	{ value: 'table', label: 'Table' },
];

export interface ViewToggleProps {
	view: PlanningView;
	onChange: (view: PlanningView) => void;
}

/**
 * Segmented control switching between the Board and Table planning views.
 */
export function ViewToggle({ view, onChange }: ViewToggleProps): JSX.Element {
	return (
		<div class={styles.toggle} role="group" aria-label="View">
			{VIEWS.map(({ value, label }) => (
				<button
					key={value}
					type="button"
					class={`${styles.option} ${view === value ? styles.active : ''}`}
					aria-pressed={view === value}
					onClick={() => onChange(value)}
				>
					{label}
				</button>
			))}
		</div>
	);
}
