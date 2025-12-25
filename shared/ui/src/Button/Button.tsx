import type { JSX, ComponentChildren } from 'preact';
import styles from './Button.module.css';

export interface ButtonProps {
	/** Button content */
	children: ComponentChildren;
	/** Click handler */
	onClick?: (e: MouseEvent) => void;
	/** Disabled state */
	disabled?: boolean;
	/** Button type */
	type?: 'button' | 'submit' | 'reset';
	/** Additional CSS class (use variant-*, size-sm, size-lg for modifiers) */
	class?: string;
	/** Aria label for icon buttons */
	'aria-label'?: string;
}

export function Button({
	children,
	onClick,
	disabled = false,
	type = 'button',
	class: className,
	'aria-label': ariaLabel,
}: ButtonProps): JSX.Element {
	return (
		<button
			type={type}
			class={`${styles.button} ${className || ''}`}
			onClick={onClick}
			disabled={disabled}
			aria-label={ariaLabel}
		>
			{children}
		</button>
	);
}
