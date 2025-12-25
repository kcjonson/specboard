import type { JSX } from 'preact';
import styles from './Select.module.css';

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
	/** Called when selection changes */
	onChange?: (e: Event) => void;
	/** Placeholder text (shown when no value selected) */
	placeholder?: string;
	/** Disabled state */
	disabled?: boolean;
	/** Additional CSS class (use size-sm, size-lg, error for modifiers) */
	class?: string;
	/** Select name */
	name?: string;
	/** Select id */
	id?: string;
}

export function Select({
	value,
	options,
	onChange,
	placeholder,
	disabled = false,
	class: className,
	name,
	id,
}: SelectProps): JSX.Element {
	return (
		<select
			class={`${styles.select} ${className || ''}`}
			value={value}
			onChange={onChange}
			disabled={disabled}
			name={name}
			id={id}
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
	);
}
