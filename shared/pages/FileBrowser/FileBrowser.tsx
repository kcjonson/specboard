import type { JSX } from 'preact';
import styles from './FileBrowser.module.css';

export interface FileBrowserProps {
	/** Additional CSS class */
	class?: string;
}

export function FileBrowser({ class: className }: FileBrowserProps): JSX.Element {
	return (
		<div class={`${styles.container} ${className || ''}`}>
			<div class={styles.header}>Files</div>
			<div class={styles.content}>
				<div class={styles.placeholder}>
					File tree coming soon...
				</div>
			</div>
		</div>
	);
}
