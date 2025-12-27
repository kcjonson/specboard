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
			class={className}
			onClick={onClick}
			disabled={disabled}
			aria-label={ariaLabel}
		>
			{children}
		</button>
	);
}
