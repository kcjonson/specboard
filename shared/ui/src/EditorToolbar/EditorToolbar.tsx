import type { JSX, ComponentChildren } from 'preact';
import styles from './EditorToolbar.module.css';

export interface ToolbarContainerProps {
	/** Toolbar content (groups and buttons) */
	children: ComponentChildren;
	/** Compact size variant for smaller editors */
	compact?: boolean;
	/** Accessible label for the toolbar */
	ariaLabel?: string;
}

/** Container for editor toolbar */
export function ToolbarContainer({
	children,
	compact = false,
	ariaLabel = 'Formatting options',
}: ToolbarContainerProps): JSX.Element {
	return (
		<div
			class={`${styles.toolbar} ${compact ? styles.compact : ''}`}
			role="toolbar"
			aria-label={ariaLabel}
		>
			{children}
		</div>
	);
}

export interface ToolbarGroupProps {
	/** Group content (buttons) */
	children: ComponentChildren;
	/** Accessible label for the group */
	ariaLabel?: string;
}

/** Group of related toolbar buttons */
export function ToolbarGroup({ children, ariaLabel }: ToolbarGroupProps): JSX.Element {
	return (
		<div class={styles.group} role="group" aria-label={ariaLabel}>
			{children}
		</div>
	);
}

export interface ToolbarSeparatorProps {
	/** Compact size variant */
	compact?: boolean;
}

/** Visual separator between button groups */
export function ToolbarSeparator({ compact = false }: ToolbarSeparatorProps): JSX.Element {
	return <div class={`${styles.separator} ${compact ? styles.compact : ''}`} />;
}

export interface ToolbarButtonProps {
	/** Whether the button is in active state */
	active: boolean;
	/** Action to perform when clicked */
	onAction: () => void;
	/** Button content (icon or text) */
	children: ComponentChildren;
	/** Tooltip text */
	title: string;
	/** Accessible label */
	ariaLabel: string;
	/** Compact size variant */
	compact?: boolean;
	/** Whether the button is disabled */
	disabled?: boolean;
}

/** Toolbar button that maintains editor focus */
export function ToolbarButton({
	active,
	onAction,
	children,
	title,
	ariaLabel,
	compact = false,
	disabled = false,
}: ToolbarButtonProps): JSX.Element {
	return (
		<button
			type="button"
			class={`${styles.button} ${active ? styles.active : ''} ${compact ? styles.compact : ''}`}
			disabled={disabled}
			onMouseDown={(event) => {
				// Prevent editor from losing focus on mouse click
				event.preventDefault();
				if (!disabled) {
					onAction();
				}
			}}
			onKeyDown={(event) => {
				// Handle keyboard activation (Enter/Space)
				if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
					event.preventDefault();
					onAction();
				}
			}}
			title={title}
			aria-label={ariaLabel}
			aria-pressed={active}
		>
			{children}
		</button>
	);
}
