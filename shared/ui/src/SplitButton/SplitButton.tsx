import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon, type IconName } from '../Icon/Icon';
import styles from './SplitButton.module.css';

export interface SplitButtonOption {
	/** Display text for this option */
	label: string;
	/** Unique identifier for this option */
	value: string;
	/** Called when this option is triggered */
	onClick: () => void;
	/** Optional icon to show next to the label in the dropdown */
	icon?: IconName;
}

export interface SplitButtonProps {
	/** Options list — first option is the default action shown on the main button */
	options: SplitButtonOption[];
	/** Optional prefix text before the default label (e.g., "+ New") */
	prefix?: string;
	/** Disabled state */
	disabled?: boolean;
	/** CSS classes passed through to root container */
	class?: string;
}

export function SplitButton({
	options,
	prefix,
	disabled = false,
	class: className,
}: SplitButtonProps): JSX.Element {
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const defaultOption = options[0];

	// Close on outside click
	useEffect(() => {
		if (!open) return;

		const handleClick = (e: MouseEvent): void => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};

		document.addEventListener('mousedown', handleClick);
		return () => document.removeEventListener('mousedown', handleClick);
	}, [open]);

	// Close on Escape
	useEffect(() => {
		if (!open) return;

		const handleKeyDown = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') {
				setOpen(false);
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [open]);

	const handleMainClick = useCallback((): void => {
		defaultOption?.onClick();
	}, [defaultOption]);

	const handleToggle = useCallback((): void => {
		setOpen((prev) => !prev);
	}, []);

	const handleOptionClick = useCallback((option: SplitButtonOption): void => {
		option.onClick();
		setOpen(false);
	}, []);

	const containerClasses = [styles.container, className].filter(Boolean).join(' ');
	const mainLabel = prefix ? `${prefix} ${defaultOption?.label ?? ''}` : (defaultOption?.label ?? '');

	return (
		<div class={containerClasses} ref={containerRef}>
			<button
				type="button"
				class={styles.main}
				onClick={handleMainClick}
				disabled={disabled}
			>
				{mainLabel}
			</button>
			<button
				type="button"
				class={styles.trigger}
				onClick={handleToggle}
				disabled={disabled}
				aria-label="More options"
				aria-expanded={open}
				aria-haspopup="menu"
			>
				<Icon name="chevron-down" class="size-xs" />
			</button>
			{open && (
				<div class={styles.menu} role="menu">
					{options.map((option) => (
						<button
							key={option.value}
							type="button"
							class={styles.option}
							role="menuitem"
							onClick={() => handleOptionClick(option)}
						>
							{option.icon && <Icon name={option.icon} class="size-sm" />}
							{option.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
