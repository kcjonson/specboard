import type { JSX, ComponentChildren } from 'preact';
import styles from './ProjectSettings.module.css';

export interface SectionHeaderProps {
	title: string;
	/** The section's own actions (Invite, Leave project), on the title's row. */
	children?: ComponentChildren;
}

/** A settings section's title, which names the page's one panel (aria-labelledby). */
export function SectionHeader({ title, children }: SectionHeaderProps): JSX.Element {
	return (
		<div class={styles.panelHeader}>
			<h2 id="settings-section-title" class={styles.panelTitle}>{title}</h2>
			{children && <div class={styles.panelActions}>{children}</div>}
		</div>
	);
}
