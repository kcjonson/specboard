import type { JSX, ComponentChildren } from 'preact';
import styles from './Badge.module.css';

export interface BadgeProps {
	/** Badge content */
	children: ComponentChildren;
	/** Additional CSS class (use variant-*, size-sm for modifiers) */
	class?: string;
	/** Tooltip text */
	title?: string;
}

export function Badge({
	children,
	class: className,
	title,
}: BadgeProps): JSX.Element {
	return (
		<span class={`${styles.badge} ${className || ''}`} title={title}>
			{children}
		</span>
	);
}
