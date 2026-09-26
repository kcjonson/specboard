import type { JSX, ComponentChildren } from 'preact';
import { WebHeader, type NavTabLabel } from '../WebHeader/WebHeader';
import styles from './Page.module.css';

export interface PageProps {
	/** Project ref (owner/project) - if provided, shows project name and nav tabs in header */
	projectRef?: string;
	/** Currently active nav tab */
	activeTab?: NavTabLabel;
	/** Page title - shown when no projectRef (for non-project pages like Settings) */
	title?: string;
	/** Page content */
	children: ComponentChildren;
	/** Additional CSS class for the content area */
	class?: string;
}

export function Page({
	projectRef,
	activeTab,
	title,
	children,
	class: className,
}: PageProps): JSX.Element {
	return (
		<div class={styles.page}>
			<WebHeader projectRef={projectRef} activeTab={activeTab} title={title} />
			<main class={`${styles.content} ${className || ''}`}>
				{children}
			</main>
		</div>
	);
}
