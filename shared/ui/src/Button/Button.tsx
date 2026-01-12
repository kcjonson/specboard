import type { JSX, ComponentChildren } from 'preact';

export interface ButtonProps {
	/** Button content */
	children: ComponentChildren;
	/** Click handler */
	onClick?: (e: MouseEvent) => void;
	/** Disabled state */
	disabled?: boolean;
	/** Button type */
	type?: 'button' | 'submit' | 'reset';
	/** CSS classes (e.g., "secondary size-sm") */
	class?: string;
	/** Aria label for icon buttons */
	'aria-label'?: string;
	/** Tooltip text */
	title?: string;
	/** Button style variant */
	variant?: 'primary' | 'secondary' | 'danger';
}

export function Button({
	children,
	onClick,
	disabled = false,
	type = 'button',
	class: className,
	'aria-label': ariaLabel,
	title,
	variant,
}: ButtonProps): JSX.Element {
	const classes = [className, variant].filter(Boolean).join(' ') || undefined;
	return (
		<button
			type={type}
			class={classes}
			onClick={onClick}
			disabled={disabled}
			aria-label={ariaLabel}
			title={title}
		>
			{children}
		</button>
	);
}
