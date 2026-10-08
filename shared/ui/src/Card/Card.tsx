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
	/** State of a card acting as a checkbox (role="checkbox") */
	'aria-checked'?: boolean;
	/** Accessible name, when the card's whole text would be too much of one */
	'aria-label'?: string;
}

export function Card({
	children,
	onClick,
	onKeyDown,
	class: className,
	tabIndex,
	role,
	'aria-checked': ariaChecked,
	'aria-label': ariaLabel,
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
			aria-checked={ariaChecked}
			aria-label={ariaLabel}
		>
			{children}
		</div>
	);
}
