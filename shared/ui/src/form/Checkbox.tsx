import type { JSX } from 'preact';
import styles from './form.module.css';

export interface CheckboxProps {
	/** Checked state (controlled) */
	checked: boolean;
	/** Label text displayed beside the box */
	label: string;
	/** Called when the state changes */
	onChange?: (e: Event) => void;
	/** Disabled state */
	disabled?: boolean;
	/** CSS classes for the label (e.g., "size-sm" for toolbar density) */
	class?: string;
	/** Input name */
	name?: string;
	/** Input id */
	id?: string;
	/**
	 * Accessible name for the box itself. For a row whose text is an editable
	 * field beside the box rather than the box's own label, `label` is empty and
	 * this carries the name instead.
	 */
	ariaLabel?: string;
}

/**
 * A labelled checkbox: the box is the native input, styled by elements.css,
 * and the label is the click target, so the whole row toggles it.
 */
export function Checkbox({
	checked,
	label,
	onChange,
	disabled = false,
	class: className,
	name,
	id,
	ariaLabel,
}: CheckboxProps): JSX.Element {
	const classes = [styles.check, className].filter(Boolean).join(' ');
	return (
		<label class={classes}>
			<input
				type="checkbox"
				checked={checked}
				onChange={onChange}
				disabled={disabled}
				name={name}
				id={id}
				aria-label={ariaLabel}
			/>
			{label}
		</label>
	);
}
