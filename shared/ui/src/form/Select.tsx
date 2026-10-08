import type { JSX } from 'preact';
import styles from './form.module.css';

export interface SelectOption {
	value: string;
	label: string;
	disabled?: boolean;
}

export interface SelectProps {
	/** Current selected value (controlled) */
	value: string;
	/** Select options */
	options: SelectOption[];
	/** Label text displayed above the select */
	label?: string;
	/** Error message displayed below the select */
	error?: string;
	/** Called when selection changes */
	onChange?: (e: Event) => void;
	/** Placeholder text (shown when no value selected) */
	placeholder?: string;
	/** Disabled state */
	disabled?: boolean;
	/** CSS classes for the select (e.g., "error") */
	class?: string;
	/** Select name */
	name?: string;
	/** Select id */
	id?: string;
	/** Accessible name when no visible `label` is used */
	ariaLabel?: string;
	/** Inline usage (toolbars): skips the reserved error line below, as Text's `compact` does. */
	compact?: boolean;
}

export function Select({
	value,
	options,
	label,
	error,
	onChange,
	placeholder,
	disabled = false,
	class: className,
	name,
	id,
	ariaLabel,
	compact = false,
}: SelectProps): JSX.Element {
	const fieldClasses = `${styles.field} ${error ? styles.hasError : ''}`;
	const errorClasses = `${styles.error} ${error ? styles.errorVisible : ''}`;

	return (
		<div class={fieldClasses}>
			{label && <label class={styles.label} htmlFor={id}>{label}</label>}
			<div class={styles.selectWrapper}>
				<select
					class={className || undefined}
					value={value}
					onChange={onChange}
					disabled={disabled}
					name={name}
					id={id}
					aria-label={ariaLabel}
				>
				{placeholder && (
					<option value="" disabled>
						{placeholder}
					</option>
				)}
				{options.map((option) => (
					<option
						key={option.value}
						value={option.value}
						disabled={option.disabled}
					>
						{option.label}
					</option>
				))}
			</select>
			</div>
			{!compact && <span class={errorClasses}>{error || '\u00A0'}</span>}
		</div>
	);
}
