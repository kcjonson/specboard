import type { JSX, ComponentChildren } from 'preact';
import { WebHeader, type NavTabLabel } from '../WebHeader/WebHeader';
import styles from './Page.module.css';

export interface PageProps {
	/** Project ID - if provided, shows project name and nav tabs in header */
	projectId?: string;
	/** Currently active nav tab */
	activeTab?: NavTabLabel;
	/** Page content */
	children: ComponentChildren;
	/** Additional CSS class for the content area */
	class?: string;
}

export function Page({
	projectId,
	activeTab,
	children,
	class: className,
}: PageProps): JSX.Element {
	return (
		<div class={styles.page}>
			<WebHeader projectId={projectId} activeTab={activeTab} />
			<main class={`${styles.content} ${className || ''}`}>
				{children}
			</main>
		</div>
	);
}
