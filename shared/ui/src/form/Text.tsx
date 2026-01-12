import type { JSX } from 'preact';
import styles from './form.module.css';

export interface TextProps {
	/** Input value (controlled) */
	value: string;
	/** Label text displayed above the input */
	label?: string;
	/** Error message displayed below the input */
	error?: string;
	/** Input type */
	type?: 'text' | 'email' | 'password' | 'number' | 'search' | 'tel' | 'url';
	/** Placeholder text */
	placeholder?: string;
	/** Called when value changes */
	onInput?: (e: Event) => void;
	/** Called on key down */
	onKeyDown?: (e: KeyboardEvent) => void;
	/** Called on blur */
	onBlur?: (e: FocusEvent) => void;
	/** Called on focus */
	onFocus?: (e: FocusEvent) => void;
	/** Disabled state */
	disabled?: boolean;
	/** Read-only state */
	readOnly?: boolean;
	/** CSS classes for the input (e.g., "size-sm") */
	class?: string;
	/** Input name */
	name?: string;
	/** Input id */
	id?: string;
	/** Autofocus */
	autoFocus?: boolean;
	/** Autocomplete */
	autoComplete?: string;
	/** Required field */
	required?: boolean;
}

export function Text({
	value,
	label,
	error,
	type = 'text',
	placeholder,
	onInput,
	onKeyDown,
	onBlur,
	onFocus,
	disabled = false,
	readOnly = false,
	class: className,
	name,
	id,
	autoFocus,
	autoComplete,
	required,
}: TextProps): JSX.Element {
	const fieldClasses = `${styles.field} ${error ? styles.hasError : ''}`;
	const errorClasses = `${styles.error} ${error ? styles.errorVisible : ''}`;

	return (
		<div class={fieldClasses}>
			{label && <label class={styles.label} htmlFor={id}>{label}</label>}
			<input
				type={type}
				class={className || undefined}
				value={value}
				placeholder={placeholder}
				onInput={onInput}
				onKeyDown={onKeyDown}
				onBlur={onBlur}
				onFocus={onFocus}
				disabled={disabled}
				readOnly={readOnly}
				name={name}
				id={id}
				autoFocus={autoFocus}
				autoComplete={autoComplete}
				required={required}
			/>
			<span class={errorClasses}>{error || '\u00A0'}</span>
		</div>
	);
}
