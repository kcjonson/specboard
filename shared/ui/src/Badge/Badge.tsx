import type { JSX, ComponentChildren } from 'preact';
import styles from './Badge.module.css';

export interface BadgeProps {
	/** Badge content */
	children: ComponentChildren;
	/** Additional CSS class (use variant-*, size-sm for modifiers) */
	class?: string;
}

export function Badge({
	children,
	class: className,
}: BadgeProps): JSX.Element {
	return (
		<span class={`${styles.badge} ${className || ''}`}>
			{children}
		</span>
	);
}
