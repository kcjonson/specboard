import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Icon } from '@specboard/ui';
import type { ProjectPicker } from './useProjectPicker';
import styles from './PickerBar.module.css';

export interface PickerBarProps {
	picker: ProjectPicker;
}

/**
 * Sits above the project grid while it picks: what the page is doing now, how many are
 * chosen, and both ways out. It stays in view as the grid scrolls, so View is never a
 * scroll away from the last card picked.
 */
export function PickerBar({ picker }: PickerBarProps): JSX.Element {
	const bar = useRef<HTMLDivElement>(null);
	// Focus lands on the bar, so a screen reader hears what the page is doing now; Tab
	// then reaches its buttons, and the cards after them.
	useEffect(() => {
		bar.current?.focus();
	}, []);

	const count = picker.chosen.length;
	return (
		<div ref={bar} class={styles.bar} role="group" aria-labelledby="project-picker-prompt" tabIndex={-1}>
			<div class={styles.text}>
				<span id="project-picker-prompt" class={styles.prompt}>Choose projects to view together</span>
				{/* A refused pick says why in the count's place, which View's label still
				    carries, so the bar doesn't grow and shove the grid under the pointer. */}
				<span class={styles.status} aria-live="polite">
					{picker.refusal ? (
						<span class={styles.refusal}>
							<Icon name="alert-circle" class={`size-sm ${styles.alert}`} />
							{picker.refusal}
						</span>
					) : (
						`${count} selected`
					)}
				</span>
			</div>
			<div class={styles.actions}>
				<Button class="secondary" onClick={picker.cancel}>Cancel</Button>
				<Button onClick={picker.view} disabled={!picker.ready}>
					View {count} {count === 1 ? 'project' : 'projects'}
				</Button>
			</div>
		</div>
	);
}
