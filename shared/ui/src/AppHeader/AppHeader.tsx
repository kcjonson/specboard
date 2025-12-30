import type { JSX, ComponentChildren } from 'preact';
import { UserMenu } from '../UserMenu/UserMenu';
import styles from './AppHeader.module.css';

export interface NavTab {
	/** Tab identifier */
	id: string;
	/** Display label */
	label: string;
	/** URL to navigate to */
	href: string;
}

export interface AppHeaderProps {
	/** Project name to display */
	projectName?: string;
	/** Navigation tabs */
	navTabs?: NavTab[];
	/** Currently active tab ID */
	activeTab?: string;
	/** Optional right-side action buttons (placed before user menu) */
	actions?: ComponentChildren;
	/** User info for the menu */
	user?: {
		displayName: string;
		email?: string;
		isAdmin?: boolean;
	};
	/** Additional CSS class */
	class?: string;
}

export function AppHeader({
	projectName,
	navTabs,
	activeTab,
	actions,
	user,
	class: className,
}: AppHeaderProps): JSX.Element {
	return (
		<header class={`${styles.header} ${className || ''}`}>
			<div class={styles.left}>
				{projectName && (
					<span class={styles.projectName}>{projectName}</span>
				)}
				{navTabs && navTabs.length > 0 && (
					<nav class={styles.nav}>
						{navTabs.map((tab) => (
							<a
								key={tab.id}
								href={tab.href}
								class={`${styles.navTab} ${activeTab === tab.id ? styles.navTabActive : ''}`}
							>
								{tab.label}
							</a>
						))}
					</nav>
				)}
			</div>
			<div class={styles.actions}>
				{actions}
				{user && (
					<UserMenu
						displayName={user.displayName}
						email={user.email}
						isAdmin={user.isAdmin}
					/>
				)}
			</div>
		</header>
	);
}
