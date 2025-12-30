import type { JSX, ComponentChildren } from 'preact';
import styles from './Card.module.css';

export interface CardProps {
	/** Card content */
	children: ComponentChildren;
	/** Click handler (adds clickable styling) */
	onClick?: (e: MouseEvent) => void;
	/** Keydown handler for keyboard navigation */
	onKeyDown?: (e: KeyboardEvent) => void;
	/** Additional CSS class (use variant-*, padding-* for modifiers) */
	class?: string;
	/** Tab index for keyboard navigation */
	tabIndex?: number;
	/** Role attribute */
	role?: JSX.HTMLAttributes<HTMLDivElement>['role'];
}

export function Card({
	children,
	onClick,
	onKeyDown,
	class: className,
	tabIndex,
	role,
}: CardProps): JSX.Element {
	const classes = [
		styles.card,
		onClick && styles.clickable,
		className,
	].filter(Boolean).join(' ');

	return (
		<div
			class={classes}
			onClick={onClick}
			onKeyDown={onKeyDown}
			tabIndex={tabIndex}
			role={role}
		>
			{children}
		</div>
	);
}
