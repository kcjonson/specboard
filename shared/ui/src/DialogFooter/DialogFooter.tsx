import type { JSX, ComponentChildren } from 'preact';
import styles from './DialogFooter.module.css';

export interface DialogFooterProps {
	/** Left-aligned actions (destructive/tertiary, e.g. a Delete button). */
	start?: ComponentChildren;
	/** Right-aligned actions. DOM order: secondary first, primary LAST. */
	children: ComponentChildren;
	/** Draw a top border — for footers that cap a scrolling body. */
	divider?: boolean;
	class?: string;
}

/**
 * The one action-row pattern for dialogs, drawers, and detail footers —
 * "Dialog" names the styling register, not a mounting requirement.
 * Below the small-screen breakpoint the row stacks full-width with the
 * primary action on top (via column-reverse over the secondary-first DOM order).
 */
export function DialogFooter({ start, children, divider, class: className }: DialogFooterProps): JSX.Element {
	const classes = [
		styles.footer,
		divider && styles.divider,
		className,
	].filter(Boolean).join(' ');

	return (
		<div class={classes}>
			{start && <div class={styles.start}>{start}</div>}
			<div class={styles.end}>{children}</div>
		</div>
	);
}
