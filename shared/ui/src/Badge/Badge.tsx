import type { JSX, ComponentChildren } from 'preact';
import styles from './Badge.module.css';

export interface BadgeProps {
	/** Badge content */
	children: ComponentChildren;
	/** Additional CSS class (variant-primary, -success, -warning, -warning-subtle, -info-subtle, -error; size-sm) */
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
