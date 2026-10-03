import type { JSX } from 'preact';
import styles from './ViewToggle.module.css';

/** The ways to view planning work items. */
export type PlanningView = 'board' | 'table' | 'map';

const VIEWS: { value: PlanningView; label: string }[] = [
	{ value: 'board', label: 'Board' },
	{ value: 'table', label: 'Table' },
	{ value: 'map', label: 'Map' },
];

export interface ViewToggleProps {
	view: PlanningView;
	onChange: (view: PlanningView) => void;
	/** False on small screens, where the Map isn't offered (spec decision 8). */
	mapAvailable: boolean;
}

/**
 * Segmented control switching between the Board, Table, and Map planning views.
 */
export function ViewToggle({ view, onChange, mapAvailable }: ViewToggleProps): JSX.Element {
	return (
		<div class={styles.toggle} role="group" aria-label="View">
			{VIEWS.filter(({ value }) => value !== 'map' || mapAvailable).map(({ value, label }) => (
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
