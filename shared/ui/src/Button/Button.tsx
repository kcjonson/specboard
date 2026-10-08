import type { JSX, ComponentChildren } from 'preact';

export interface ButtonProps {
	/** Button content */
	children: ComponentChildren;
	/** Click handler */
	onClick?: (e: MouseEvent) => void;
	/** Disabled state */
	disabled?: boolean;
	/**
	 * Working on the last click: announced as busy and ignoring clicks, but still enabled,
	 * so a focused button keeps focus (a disabled one drops it to the page).
	 */
	busy?: boolean;
	/** Button type */
	type?: 'button' | 'submit' | 'reset';
	/** CSS classes (e.g., "secondary size-sm") */
	class?: string;
	/** Aria label for icon buttons */
	'aria-label'?: string;
	/** Toggle state; a secondary button renders pressed when true */
	'aria-pressed'?: boolean;
	/** For a button that shows and hides a region: whether it's showing */
	'aria-expanded'?: boolean;
	/** The id of the region the button shows and hides */
	'aria-controls'?: string;
	/** Tooltip text */
	title?: string;
	/** Button style variant */
	variant?: 'primary' | 'secondary' | 'danger';
}

export function Button({
	children,
	onClick,
	disabled = false,
	busy = false,
	type = 'button',
	class: className,
	'aria-label': ariaLabel,
	'aria-pressed': ariaPressed,
	'aria-expanded': ariaExpanded,
	'aria-controls': ariaControls,
	title,
	variant,
}: ButtonProps): JSX.Element {
	const classes = [className, variant].filter(Boolean).join(' ') || undefined;
	return (
		<button
			type={type}
			class={classes}
			onClick={busy ? (e) => e.preventDefault() : onClick}
			disabled={disabled}
			aria-busy={busy || undefined}
			aria-disabled={busy || undefined}
			aria-label={ariaLabel}
			aria-pressed={ariaPressed}
			aria-expanded={ariaExpanded}
			aria-controls={ariaControls}
			title={title}
		>
			{children}
		</button>
	);
}
