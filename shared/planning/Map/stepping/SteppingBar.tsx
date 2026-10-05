import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { nextStep, stepText } from './stepping';
import styles from './SteppingBar.module.css';

export interface SteppingBarProps {
	/** What is being stepped through: `Matches for "checklist"`, or the changes view's `Since your last visit, Sep 19`. */
	title: string;
	/** The items to step through, in the order to step. */
	keys: readonly string[];
	/** The count's singular and plural, for before the first step. */
	unit?: readonly [string, string];
	/** Says so in the count's place when there is nothing to step through: `No matches`. */
	empty: string;
	/** An answer is on its way, so the steps wait for it. */
	busy?: boolean;
	/** A step lands on this item: the caller focuses it and pans to it. */
	onStep(key: string): void;
	/** Holds a function that steps, while the bar is open: the Map's `]` and `[` call it, since the Map owns the keys. */
	stepRef?: { current: ((delta: 1 | -1) => void) | null };
	/** Ends the search or the view. */
	onClose(): void;
	closeLabel: string;
	/** A button for the bar's empty state, such as retrying a failed search. */
	action?: { label: string; onClick(): void };
	/** A button that is always there, ahead of the close one: the changes view's Mark all seen. */
	accept?: { label: string; onClick(): void };
}

/**
 * The bar on the canvas that steps through a list of items (spec, Navigation and
 * interaction): a title, previous and next, and where it is in the list. `]` and `[` do what
 * the arrows do, wrapping at the ends; the Map, which owns the keys, presses them through
 * `stepRef`. It knows nothing of what it steps through, so search matches and the changes
 * view share it.
 */
export function SteppingBar({ title, keys, unit = ['result', 'results'], empty, busy = false, onStep, stepRef, onClose, closeLabel, action, accept }: SteppingBarProps): JSX.Element {
	// The item stepped to, by key, so a list that changes under the bar (a poll, a filter) keeps its place if the item is still in it.
	const [current, setCurrent] = useState<string | null>(null);
	const at = current === null ? -1 : keys.indexOf(current);
	const steppable = keys.length > 0 && !busy;

	const live = useRef({ keys, at, steppable, onStep });
	live.current = { keys, at, steppable, onStep };
	const step = (delta: 1 | -1): void => {
		const { keys: list, at: index, steppable: ready, onStep: stepTo } = live.current;
		if (!ready) return;
		const key = list[nextStep(index, delta, list.length)]!;
		setCurrent(key);
		stepTo(key);
	};

	useEffect(() => {
		if (!stepRef) return;
		stepRef.current = step;
		return () => {
			if (stepRef.current === step) stepRef.current = null;
		};
	}, [stepRef]);

	return (
		<div class={styles.bar} role="region" aria-label={title}>
			<span class={styles.title}>{title}</span>
			{keys.length > 0 && (
				<button type="button" class={styles.arrow} aria-label="Previous" title="Previous ([)" disabled={!steppable} onClick={() => step(-1)}>
					<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 2.5 L4 6 L7.5 9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
				</button>
			)}
			<span class={styles.count} role="status">{busy ? 'Searching...' : keys.length === 0 ? empty : stepText(at, keys.length, unit)}</span>
			{keys.length > 0 && (
				<button type="button" class={styles.arrow} aria-label="Next" title="Next (])" disabled={!steppable} onClick={() => step(1)}>
					<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 L8 6 L4.5 9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
				</button>
			)}
			{action && keys.length === 0 && !busy && <button type="button" class={styles.button} onClick={action.onClick}>{action.label}</button>}
			{accept && <button type="button" class={`${styles.button} ${styles.primary}`} onClick={accept.onClick}>{accept.label}</button>}
			<button type="button" class={styles.button} onClick={onClose}>{closeLabel}</button>
		</div>
	);
}
