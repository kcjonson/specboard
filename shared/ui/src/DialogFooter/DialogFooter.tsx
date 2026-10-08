import type { JSX, ComponentChildren } from 'preact';
import styles from './DialogFooter.module.css';

export interface DialogFooterProps {
	/** Right-aligned actions. DOM order: secondary first, primary LAST. */
	children: ComponentChildren;
	/** Draw a top border — for footers that cap a scrolling body. */
	divider?: boolean;
	/** Keep it in view at the bottom of a Dialog whose body scrolls (a long form). */
	pinned?: boolean;
	class?: string;
}

/**
 * The one action-row pattern for dialogs, drawers, and detail footers —
 * "Dialog" names the styling register, not a mounting requirement.
 * Below the small-screen breakpoint the row stacks full-width with the
 * primary action on top (via column-reverse over the secondary-first DOM order).
 */
export function DialogFooter({ children, divider, pinned, class: className }: DialogFooterProps): JSX.Element {
	const classes = [
		styles.footer,
		divider && styles.divider,
		pinned && styles.pinned,
		className,
	].filter(Boolean).join(' ');

	return (
		<div class={classes}>
			<div class={styles.end}>{children}</div>
		</div>
	);
}
