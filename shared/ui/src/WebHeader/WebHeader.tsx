import { useMemo } from 'preact/hooks';
import type { JSX, ComponentChildren } from 'preact';
import { useModel, UserModel } from '@doc-platform/models';
import { UserMenu } from '../UserMenu/UserMenu';
import styles from './WebHeader.module.css';

/** Navigation tab labels - use these for activeTab prop */
export type NavTabLabel = 'Planning' | 'Pages';

interface NavTab {
	label: NavTabLabel;
	path: string;
}

const NAV_TABS: NavTab[] = [
	{ label: 'Planning', path: 'planning' },
	{ label: 'Pages', path: 'pages' },
];

function formatProjectName(id: string): string {
	return id.charAt(0).toUpperCase() + id.slice(1);
}

export interface WebHeaderProps {
	/** Project ID - if provided, shows project name and nav tabs */
	projectId?: string;
	/** Currently active tab (matches NavTabLabel) */
	activeTab?: NavTabLabel;
	/** Optional right-side action buttons (placed before user menu) */
	actions?: ComponentChildren;
	/** Additional CSS class */
	class?: string;
}

export function WebHeader({
	projectId,
	activeTab,
	actions,
	class: className,
}: WebHeaderProps): JSX.Element {
	// Create and bind UserModel - request deduplication prevents duplicate API calls
	const user = useMemo(() => new UserModel({ id: 'me' }), []);
	useModel(user);

	const isAdmin = user.roles?.includes('admin');

	return (
		<header class={`${styles.header} ${className || ''}`}>
			<div class={styles.left}>
				{projectId && (
					<>
						<span class={styles.projectName}>{formatProjectName(projectId)}</span>
						<nav class={styles.nav}>
							{NAV_TABS.map((tab) => (
								<a
									key={tab.label}
									href={`/projects/${projectId}/${tab.path}`}
									class={`${styles.navTab} ${activeTab === tab.label ? styles.navTabActive : ''}`}
								>
									{tab.label}
								</a>
							))}
						</nav>
					</>
				)}
			</div>
			<div class={styles.actions}>
				{actions}
				{user.first_name && (
					<UserMenu
						displayName={`${user.first_name} ${user.last_name}`.trim()}
						email={user.email}
						isAdmin={isAdmin}
					/>
				)}
			</div>
		</header>
	);
}
