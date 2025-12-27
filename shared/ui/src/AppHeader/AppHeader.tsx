import type { JSX, ComponentChildren } from 'preact';
import { UserMenu } from '../UserMenu/UserMenu';
import styles from './AppHeader.module.css';

export interface AppHeaderProps {
	/** Page or app title */
	title: string;
	/** Optional left-side content (placed after title) */
	leftContent?: ComponentChildren;
	/** Optional right-side action buttons (placed before user menu) */
	actions?: ComponentChildren;
	/** User info for the menu */
	user?: {
		displayName: string;
		email?: string;
	};
	/** Called when Settings is clicked */
	onSettingsClick?: () => void;
	/** Called when Logout is clicked */
	onLogoutClick?: () => void;
	/** Additional CSS class */
	class?: string;
}

export function AppHeader({
	title,
	leftContent,
	actions,
	user,
	onSettingsClick,
	onLogoutClick,
	class: className,
}: AppHeaderProps): JSX.Element {
	return (
		<header class={`${styles.header} ${className || ''}`}>
			<div class={styles.left}>
				<h1 class={styles.title}>{title}</h1>
				{leftContent}
			</div>
			<div class={styles.actions}>
				{actions}
				{user && (
					<UserMenu
						displayName={user.displayName}
						email={user.email}
						onSettingsClick={onSettingsClick}
						onLogoutClick={onLogoutClick}
					/>
				)}
			</div>
		</header>
	);
}
